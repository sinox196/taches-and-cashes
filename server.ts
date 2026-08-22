import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { initDb, DEFAULT_LEAVE_ENTITLEMENT } from './src/server/database.js';
import { STAFF_ROLES, DASHBOARD_ROLES, HR_APPROVER_ROLES } from './src/constants/roles.js';
import {
  DEFAULT_AWAY_AFTER_MINUTES, OFFLINE_AFTER_MS, clampAwayMinutes, type PresenceState,
} from './src/constants/presence.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

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
 * public/logos/), and the recurring obligation types read off the
 * cabinet's own échéances tracking sheet. Idempotent — checked by id,
 * safe on every boot.
 *
 * The "Détail des frais administratifs" reference table from the SARL
 * document has no table of its own in the V1 data model (the spec defines
 * none for it); it is attached as an informational, non-blocking item on the
 * Patente checklist rather than inventing a new structure for one table.
 *
 * The exact statutory day for each échéance type below is a best-effort
 * default read off well-known Tunisian filing conventions (the TVA-mensuelle
 * one — jour 28 — is the cahier des charges' own worked example). They are
 * fully editable from the Ressources métier screen: a cabinet should verify
 * each one against the current tax calendar before relying on the alerts.
 */
async function seedResourceLibrary(db: import('./src/server/db-types.js').Database) {
  const SECTOR_COMPTA = 'Expertise comptable';

  const existingTemplates = await db.getAllResourceTemplates();
  const seedChecklist = async (id: string, name: string, sector: string, items: string[]) => {
    if (existingTemplates.some((t: any) => t.id === id)) return;
    const template = await db.createResourceTemplate({
      id, type: 'document_checklist', name, sector,
      isSequential: false, isActive: true, isSystem: true,
      sourceSystemTemplateId: null, createdAt: new Date().toISOString(),
    });
    let i = 0;
    for (const label of items) {
      await db.createResourceTemplateItem({ id: `${template.id}-item-${i}`, templateId: template.id, label, sortOrder: i });
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

  const existingLinks = await db.getAllUsefulLinks();
  const seedLink = async (
    id: string, category: string, label: string, url: string,
    opts: { description?: string; icon?: string } = {},
  ) => {
    if (existingLinks.some((l: any) => l.id === id)) return;
    await db.createUsefulLink({
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

  const existingDeadlines = await db.getAllDeadlineTemplates();
  const seedDeadline = async (id: string, name: string, recurrenceRule: string, leadTimeDays = 7) => {
    if (existingDeadlines.some((t: any) => t.id === id)) return;
    await db.createDeadlineTemplate({
      id, name, recurrenceRule, leadTimeDays, sector: SECTOR_COMPTA,
      missionId: null, taskTypeId: null, isActive: true, isSystem: true,
    });
  };
  // Recurring obligation types read off the cabinet's own échéances tracking
  // sheet (DM, D SUSP TVA TRx, CNSS TRx, IS, IRPP, DEC EMPLOYEUR, RNE Bilan).
  await seedDeadline('dtpl-seed-tva-mensuelle', 'Déclaration mensuelle de TVA (DM)', 'MONTHLY(day=28)');
  await seedDeadline('dtpl-seed-tva-suspension-trim', 'Déclaration de suspension de TVA (trimestrielle)', 'QUARTERLY(day=28)');
  await seedDeadline('dtpl-seed-cnss-trim', 'Déclaration CNSS (trimestrielle)', 'QUARTERLY(day=15)');
  await seedDeadline('dtpl-seed-is-annuel', "Déclaration de l'impôt sur les sociétés (IS)", 'ANNUAL(month=3,day=25)', 14);
  await seedDeadline('dtpl-seed-irpp-annuel', 'Déclaration IRPP (personnes physiques)', 'ANNUAL(month=12,day=5)', 14);
  await seedDeadline('dtpl-seed-declaration-employeur', "Déclaration annuelle de l'employeur", 'ANNUAL(month=2,day=28)', 14);
  await seedDeadline('dtpl-seed-rne-bilan', 'Dépôt du bilan annuel au RNE', 'ANNUAL(month=7,day=31)', 14);
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
  await seedResourceLibrary(db);

  // ---------------------------------------------------------
  // Auth & API Routes
  // ---------------------------------------------------------

  // POST /api/login
  app.post('/api/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      const user = await db.get('SELECT * FROM users WHERE username = ?', username);
      
      if (!user) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }
      
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '1d' });
      
      res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          permissions: JSON.parse(user.permissions),
          salaireBrut: user.salaireBrut,
          regimeHoraire: user.regimeHoraire
        }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Authentication Middleware
  const authenticate = (req: any, res: any, next: any) => {
    const token = req.headers.authorization?.split(' ')[1] || req.query.token;
    if (!token) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    
    try {
      req.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch (e) {
      res.status(401).json({ error: 'Invalid token' });
    }
  };

  // GET /api/me
  app.get('/api/me', authenticate, async (req: any, res: any) => {
    try {
      const user = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
      if (!user) {
         res.status(404).json({ error: 'User not found' });
         return;
      }
      res.json({
        id: user.id,
        username: user.username,
        role: user.role,
        permissions: JSON.parse(user.permissions),
        salaireBrut: user.salaireBrut,
        regimeHoraire: user.regimeHoraire
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
      db.get('SELECT * FROM users WHERE id = ?', req.user.id).then((user: any) => {
        if (!user) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        
        const hasPerm = user.role === 'ADMIN' || JSON.parse(user.permissions).includes(permission);
        if (!hasPerm) {
          return res.status(403).json({ error: 'Forbidden: Missing permission ' + permission });
        }
        next();
      }).catch(() => {
        res.status(500).json({ error: 'Internal server error' });
      });
    };
  };

  // GET /api/settings
  app.get('/api/settings', authenticate, requirePermission('ADMIN'), async (req: any, res: any) => {
    try {
      const settings = await db.getSettings();
      res.json(settings || {});
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/settings
  app.put('/api/settings', authenticate, requirePermission('ADMIN'), async (req: any, res: any) => {
    try {
      const updates = req.body;
      const updated = await db.updateSettings(updates);
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
  const companyBlock = (settings: any) => ({
    company: {
      name: String(settings?.company?.name || ''),
      address: String(settings?.company?.address || ''),
      taxId: String(settings?.company?.taxId || ''),
      email: String(settings?.company?.email || ''),
      phone: String(settings?.company?.phone || ''),
    },
    bank: {
      name: String(settings?.bank?.name || ''),
      iban: String(settings?.bank?.iban || ''),
    },
    logo: typeof settings?.logo === 'string' ? settings.logo : '',
    signature: typeof settings?.signature === 'string' ? settings.signature : '',
  });

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
  app.get('/api/cash/company', authenticate, requirePermission('VIEW_CASH'), async (_req: any, res: any) => {
    try {
      res.json(companyBlock(await db.getSettings()));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** Writable with MANAGE_CASH — it is invoicing identity, not a global setting. */
  app.put('/api/cash/company', authenticate, requirePermission('MANAGE_CASH'), async (req: any, res: any) => {
    try {
      const body = req.body || {};
      const text = (v: any, max: number) => String(v ?? '').trim().slice(0, max);

      // A signature/logo is a small inline image. Anything else — a remote
      // URL, a script-bearing SVG — is refused rather than stored and later rendered.
      let signature = typeof body.signature === 'string' ? body.signature : undefined;
      if (signature !== undefined) {
        const err = validateInlineImage(signature, 'La signature');
        if (err) return res.status(400).json({ error: err });
      }
      let logo = typeof body.logo === 'string' ? body.logo : undefined;
      if (logo !== undefined) {
        const err = validateInlineImage(logo, 'Le logo');
        if (err) return res.status(400).json({ error: err });
      }

      const current = await db.getSettings();
      const updated = await db.updateSettings({
        company: {
          name: text(body.company?.name, 120),
          address: text(body.company?.address, 300),
          taxId: text(body.company?.taxId, 60),
          email: text(body.company?.email, 120),
          phone: text(body.company?.phone, 40),
        },
        bank: {
          name: text(body.bank?.name, 120),
          iban: text(body.bank?.iban, 60),
        },
        logo: logo !== undefined ? logo : (current?.logo ?? ''),
        signature: signature !== undefined ? signature : (current?.signature ?? ''),
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
      const users = await db.getAllUsers();
      const balances = await db.getAllLeaveBalances();
      // Don't send passwords to client. Same shape as POST/PUT responses so the
      // list can be updated in place after a create/edit.
      res.json(users.map((u: any) => withLeaveBalance(publicUser(u), balances)));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/users
  app.post('/api/users', authenticate, requirePermission('MANAGE_USERS'), async (req: any, res: any) => {
    try {
      const { username, password, role, permissions, salaireBrut, regimeHoraire, cnss, tfp, foprolos, accidentTravail, primesFraisNonCotisables, soldeConge } = req.body;

      const existing = await db.get('SELECT * FROM users WHERE username = ?', username);
      if (existing) {
        return res.status(400).json({ error: 'Username already exists' });
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

      const newUser = await db.createUser({
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
      await db.updateLeaveBalance(newUser.id, {
        entitlement: num(soldeConge, DEFAULT_LEAVE_ENTITLEMENT),
        used: 0,
      });

      res.json(withLeaveBalance(publicUser(newUser), await db.getAllLeaveBalances()));
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
      
      const updatedUser = await db.updateUser(id, updates);
      if (!updatedUser) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      // Changing the allowance never touches days already consumed.
      if (typeof soldeConge === 'number') {
        await db.updateLeaveBalance(id, { entitlement: soldeConge });
      }

      res.json(withLeaveBalance(publicUser(updatedUser), await db.getAllLeaveBalances()));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  // DELETE /api/users/:id
  app.delete('/api/users/:id', authenticate, requirePermission('MANAGE_USERS'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const success = await db.deleteUser(id);
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

  // GET /api/clients
  app.get('/api/clients', authenticate, requirePermission('VIEW_CLIENTS'), async (req: any, res: any) => {
    try {
      let clients = await db.getAllClients();

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

      // 3. Sorting
      const sortField = req.query.sortField || 'createdAt';
      const sortDir = req.query.sortDir || 'desc';

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
      
      // If client didn't explicitly request pagination, maybe return array to preserve backward compatibility? 
      // The user wants "Do not load the entire Clients database... Use pagination".
      // We will ALWAYS return pagination wrapper if page/limit is provided, else we return array.
      if (req.query.page) {
        const total = clients.length;
        const startIndex = (page - 1) * limit;
        const paginated = clients.slice(startIndex, startIndex + limit);
        res.json({ data: paginated, total, page, limit });
      } else {
        res.json(clients);
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/clients/fields
  app.get('/api/clients/fields', authenticate, requirePermission('VIEW_CLIENTS'), async (req: any, res: any) => {
    try {
      const clients = await db.getAllClients();
      const customFieldKeys = new Set<string>();
      clients.forEach((c: any) => {
        if (c.customFields) {
          Object.keys(c.customFields).forEach(k => customFieldKeys.add(k));
        }
      });
      res.json(Array.from(customFieldKeys));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/clients/:id
  app.get('/api/clients/:id', authenticate, requirePermission('VIEW_CLIENTS'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const client = await db.getClientById(id);
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
  let users = await db.getAllUsers();
  users = users.filter((u: any) => u.role !== 'ADMIN');
  if (q) {
    users = users.filter((u: any) => 
      u.username.toLowerCase().includes(q) || 
      (u.fullName && u.fullName.toLowerCase().includes(q))
    );
  }
  // limit to 10 for autocomplete
  res.json(users.slice(0, 10).map((u: any) => ({ id: u.id, name: u.fullName || u.username, role: u.role })));
});

app.get('/api/kpi/clients/search', authenticate, async (req: any, res: any) => {
  if (!DASHBOARD_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const q = (req.query.q || '').toLowerCase();
  let clients = await db.getAllClients();
  if (q) {
    clients = clients.filter((c: any) => c.name.toLowerCase().includes(q));
  }
  // limit to 10
  res.json(clients.slice(0, 10).map((c: any) => ({ id: c.id, name: c.name })));
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
    const allUsers = await db.getAllUsers();
    const usersById = new Map<number, any>(allUsers.map((u: any) => [u.id, u]));

    const entries = filterKpiEntries(await db.getAllTimeEntries() || [], req.body)
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
    const clients = await db.getAllClients() || [];
    const clientsById = new Map<number, any>(clients.map((c: any) => [c.id, c]));

    const entries = filterKpiEntries(await db.getAllTimeEntries() || [], req.body)
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
    const allUsers = await db.getAllUsers();
    let timeEntries = await db.getAllTimeEntries() || [];
    let leaveRequests = await db.getAllLeaveRequests() || [];
    let authorizations = await db.getAllAbsenceAuthorizations() || [];
    let clients = await db.getAllClients() || [];
    let leaveBalances = await db.getAllLeaveBalances() || [];

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
    
    const kpiSettings = await db.getSettings();
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
    const invoiceBuckets = new Map<string, { netToPay: number; paid: number; count: number }>();
    const allInvoices = await db.getAllInvoices() || [];
    for (const inv of allInvoices) {
      const ts = parseIsoDate(inv.issueDate);
      if (ts < startTs || ts > endTs) continue;
      if (filterClientIds && filterClientIds.length > 0 && !filterClientIds.includes(inv.clientId)) continue;
      const key = clientBucketKey({ clientId: inv.clientId, client: inv.clientName });
      const acc = invoiceBuckets.get(key) || { netToPay: 0, paid: 0, count: 0 };
      acc.netToPay += num(Number(inv.totalNetToPay), 0);
      acc.paid += num(Number(inv.totalPaid), 0);
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
        // Billing for the same client over the same period. `remainingToPay`
        // stays derived rather than summed from the documents, so it can never
        // disagree with the two figures shown beside it.
        invoiceCount: invoiceBuckets.get(key)?.count ?? 0,
        netToPay: round3(invoiceBuckets.get(key)?.netToPay ?? 0),
        totalPaid: round3(invoiceBuckets.get(key)?.paid ?? 0),
        remainingToPay: round3((invoiceBuckets.get(key)?.netToPay ?? 0) - (invoiceBuckets.get(key)?.paid ?? 0)),
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
      netToPay, totalPaid, remainingToPay, invoiceCount,
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
      const { name, type, email, phone, address, city, country, taxId, status, notes, customFields } = req.body;
      
      if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Client name is required' });
      }

      const newClient = await db.createClient({
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
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: req.user.id
      });
      
      res.status(201).json(newClient);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/clients/:id
  app.put('/api/clients/:id', authenticate, requirePermission('EDIT_CLIENTS'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { name, type, email, phone, address, city, country, taxId, status, notes, customFields } = req.body;
      
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
        updatedAt: new Date().toISOString()
      };
      
      const updated = await db.updateClient(id, updates);
      if (!updated) {
        return res.status(404).json({ error: 'Client not found' });
      }
      
      res.json(updated);
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

      const existing = await db.getAllClients();
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
      const results = await Promise.allSettled(toCreate.map((c) => db.createClient(c)));
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
      const updated = await db.updateClient(id, { status: 'Inactive', updatedAt: new Date().toISOString() });
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
      const services = await db.getAllServices();
      res.json(services);
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

      const newService = await db.createService({
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
      
      const updated = await db.updateService(id, updates);
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
      const removed = await db.deleteService(id);
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
      let taskTypes = await db.getAllTaskTypes();
      if (req.query.serviceId) {
        const sid = parseInt(req.query.serviceId, 10);
        taskTypes = taskTypes.filter((t: any) => t.serviceId === sid);
      }
      res.json(taskTypes);
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
      if (!Number.isFinite(sid) || !(await db.getServiceById(sid))) {
        return res.status(400).json({ error: 'A valid mission is required' });
      }
      const created = await db.createTaskType({
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
        if (!Number.isFinite(sid) || !(await db.getServiceById(sid))) {
          return res.status(400).json({ error: 'A valid mission is required' });
        }
        updates.serviceId = sid;
      }
      const updated = await db.updateTaskType(id, updates);
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
      const removed = await db.deleteTaskType(id);
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
   */
  const presence = new Map<number, { lastSeenAt: number; lastActivityAt: number }>();

  /**
   * The server owns this decision. A client can report how long it has been
   * idle, but it cannot report that its own machine is off — that is only
   * visible here, as heartbeats that stopped arriving.
   */
  /**
   * The away threshold is configurable, and presence is evaluated on every
   * heartbeat from every user, so it is cached rather than re-read from the
   * database each time. A few seconds of staleness after an admin changes it is
   * irrelevant to a 30-minute threshold.
   */
  let awayMsCache = { value: DEFAULT_AWAY_AFTER_MINUTES * 60 * 1000, at: 0 };
  const awayAfterMs = async () => {
    if (Date.now() - awayMsCache.at < 10_000) return awayMsCache.value;
    const settings = await db.getSettings();
    const value = clampAwayMinutes(settings?.awayAfterMinutes ?? DEFAULT_AWAY_AFTER_MINUTES) * 60 * 1000;
    awayMsCache = { value, at: Date.now() };
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

  const presenceFor = (userId: number, awayMs: number) => {
    const rec = presence.get(userId);
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
    const awayMs = await awayAfterMs();
    const reported = Number(req.body?.idleMs);
    const idleMs = Number.isFinite(reported) && reported >= 0 ? Math.min(reported, awayMs * 6) : 0;
    presence.set(req.user.id, { lastSeenAt: now, lastActivityAt: now - idleMs });
    res.json({ userId: req.user.id, ...presenceFor(req.user.id, awayMs) });
  });

  /**
   * The away threshold, readable by anyone (the browser needs it to show its
   * own badge without waiting for the next poll) and writable only with
   * MANAGE_PRESENCE_SETTINGS. The server still decides every state — this only
   * tells the client which threshold it is being judged against.
   */
  app.get('/api/presence/settings', authenticate, async (_req: any, res: any) => {
    const settings = await db.getSettings();
    res.json({ awayAfterMinutes: clampAwayMinutes(settings?.awayAfterMinutes ?? DEFAULT_AWAY_AFTER_MINUTES) });
  });

  app.put('/api/presence/settings', authenticate, requirePermission('MANAGE_PRESENCE_SETTINGS'), async (req: any, res: any) => {
    const raw = req.body?.awayAfterMinutes;
    if (raw === undefined || raw === null || raw === '' || !Number.isFinite(Number(raw))) {
      return res.status(400).json({ error: 'awayAfterMinutes doit être un nombre de minutes.' });
    }
    const awayAfterMinutes = clampAwayMinutes(raw);
    await db.updateSettings({ awayAfterMinutes });
    awayMsCache = { value: awayAfterMinutes * 60 * 1000, at: Date.now() };
    res.json({ awayAfterMinutes });
  });

  /** Sent on logout / tab close so the user drops to inactive immediately. */
  app.post('/api/presence/offline', authenticate, (req: any, res: any) => {
    presence.delete(req.user.id);
    res.json({ success: true });
  });

  /** Presence of every known user, keyed by id. */
  app.get('/api/presence', authenticate, async (req: any, res: any) => {
    try {
      const users = await db.getAllUsers();
      const awayMs = await awayAfterMs();
      const byUser: Record<string, any> = {};
      for (const u of users) byUser[u.id] = presenceFor(u.id, awayMs);
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
    const lines = Array.isArray(invoice.lines) ? invoice.lines : [];


    let totalHT = 0;
    const vatByRate = new Map<number, number>();
    for (const line of lines) {
      const ht = num(Number(line.montantHT), 0);
      totalHT += ht;
      const rate = suspended ? 0 : num(Number(line.vatRate), 0);
      vatByRate.set(rate, (vatByRate.get(rate) || 0) + ht);
    }

    const vatBreakdown = [...vatByRate.entries()]
      .filter(([rate]) => !suspended && rate > 0)
      .map(([rate, base]) => ({ rate, base: round3(base), amount: round3(base * rate) }))
      .sort((a, b) => a.rate - b.rate);

    const totalHTr = round3(totalHT);
    const totalVAT = round3(vatBreakdown.reduce((s, v) => s + v.amount, 0));
    const totalTTC = round3(totalHTr + totalVAT);                                   // (3)
    const withholdingRate = num(Number(invoice.withholdingRate), 0);                // (4)
    const withholdingAmount = round3(totalTTC * withholdingRate);                   // (5)
    const stampDuty = num(Number(invoice.stampDuty), 0);                            // (6)
    const netToPay = round3(totalTTC - withholdingAmount + stampDuty);              // (7)
    const disbursements = num(Number(invoice.disbursements), 0);                    // (8)
    const advances = num(Number(invoice.advances), 0);                              // (9)
    const totalNetToPay = round3(netToPay + disbursements - advances);              // (10)

    return {
      vatBreakdown,
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
   * Encaissements — what the client has actually paid against a document.
   *
   * A document can be settled in several instalments, so this is a *list*, each
   * entry carrying its own amount and date; the two figures shown in the Cash
   * table are derived from it and never stored independently:
   *
   *   totalPaid     = sum of the encaissements
   *   remainingToPay = (10) total net à payer − totalPaid
   *
   * Deliberately outside `computeInvoiceTotals()`, which owns the numbered
   * cascade (1)–(10) of the cahier des charges and stops at (10). Payments come
   * after the document is issued and must not shift any of those numbers.
   *
   * `remainingToPay` may go negative (an overpayment); that is surfaced rather
   * than clamped, because silently showing 0 would hide a real accounting error.
   */
  const normalizePayments = (rawPayments: any): any[] => {
    if (!Array.isArray(rawPayments)) return [];
    return rawPayments
      .map((p: any) => ({
        id: String(p?.id || `pay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        amount: round3(num(Number(p?.amount), 0)),
        date: String(p?.date || '').slice(0, 10),
        note: String(p?.note || '').trim(),
      }))
      .filter((p: any) => p.date && Number.isFinite(p.amount))
      // Chronological, so the table reads as a payment history.
      .sort((a: any, b: any) => a.date.localeCompare(b.date));
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
      .filter((i: any) => i.documentKind !== 'AUTRE' && i.id !== selfId && i.issueDate)
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

  const computePaymentState = (totalNetToPay: number, rawPayments: any) => {
    const payments = normalizePayments(rawPayments);
    const totalPaid = round3(payments.reduce((sum: number, p: any) => sum + p.amount, 0));
    return { payments, totalPaid, remainingToPay: round3(totalNetToPay - totalPaid) };
  };

  app.get('/api/invoices', authenticate, requirePermission('VIEW_CASH'), async (req: any, res: any) => {
    try {
      const all = await db.getAllInvoices();
      const q = String(req.query.q || '').toLowerCase();
      const filtered = q
        ? all.filter((i: any) =>
            (i.number || '').toLowerCase().includes(q) ||
            (i.clientName || '').toLowerCase().includes(q) ||
            (i.title || '').toLowerCase().includes(q))
        : all;
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
      const offset = parseInt(req.query.offset, 10) || 0;
      res.json({ data: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/invoices/:id', authenticate, requirePermission('VIEW_CASH'), async (req: any, res: any) => {
    try {
      const invoice = await db.getInvoiceById(req.params.id);
      if (!invoice) return res.status(404).json({ error: 'Document introuvable' });
      res.json(invoice);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** Peek at the number the next document will get (display only; not reserved). */
  app.get('/api/invoices/meta/next-number', authenticate, requirePermission('MANAGE_CASH'), async (req: any, res: any) => {
    try {
      const settings = await db.getSettings();
      const current = typeof settings.invoiceCounter === 'number' ? settings.invoiceCounter : 0;
      const all = await db.getAllInvoices();
      // Only the legal sequence carries the date rule, so only a *legal*
      // invoice can bound the next one. Returning the newest document of any
      // kind let an autre document — which is exempt — set a floor the server
      // would never have enforced.
      const lastLegal = all.find((i: any) => i.documentKind !== 'AUTRE');
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

      const kind = body.documentKind === 'AUTRE' ? 'AUTRE' : 'FACTURE_LEGALE';
      const all = await db.getAllInvoices();

      // Only a legal invoice is bound to the sequence. "Autre document" carries
      // a free reference (bon de livraison, reçu…), so it neither follows the
      // sequence nor consumes a number from it — doing so would punch gaps in
      // the legal numbering.
      let number: string;
      if (kind === 'AUTRE') {
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
      const paymentState = computePaymentState(totals.totalNetToPay, body.payments);
      if (kind !== 'AUTRE') number = await db.nextInvoiceNumber();

      const invoice = await db.createInvoice({
        id: `inv-${Date.now()}`,
        number,
        documentKind: kind,
        title: String(body.title || 'Facture').trim(),
        billingMode: body.billingMode === 'DETAILLEE' ? 'DETAILLEE' : 'FORFAIT',
        vatRegime: body.vatRegime === 'SUSPENSION' ? 'SUSPENSION' : 'DROIT_COMMUN',
        clientId: body.clientId ?? null,
        clientName: body.clientName || '',
        clientTaxId: body.clientTaxId || '',
        clientAddress: body.clientAddress || '',
        customFields: body.customFields && typeof body.customFields === 'object' ? body.customFields : {},
        issueDate: body.issueDate,
        dueDate: body.dueDate || '',
        showDueDate: body.showDueDate !== false,
        lines: body.lines.map((l: any) => ({
          designation: String(l.designation || '').trim(),
          quantity: num(Number(l.quantity), 1),
          unitPrice: num(Number(l.unitPrice), 0),
          vatRate: num(Number(l.vatRate), 0),
          montantHT: num(Number(l.montantHT), 0),
        })),
        ...totals,
        ...paymentState,
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
      const existing = await db.getInvoiceById(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Document introuvable' });

      const merged = { ...existing, ...req.body };

      // A legal invoice's number belongs to the sequence and is never
      // reassigned; a free document's may be corrected.
      if (merged.documentKind === 'AUTRE') {
        const wanted = String(req.body?.number ?? existing.number ?? '').trim();
        if (!wanted) {
          return res.status(400).json({ error: 'Le numéro du document est obligatoire' });
        }
        const all = await db.getAllInvoices();
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
      if (merged.documentKind !== 'AUTRE') {
        const dateError = legalSequenceDateError(
          await db.getAllInvoices(), existing.id, Number(merged.number), merged.issueDate,
        );
        if (dateError) return res.status(400).json({ error: dateError });
      }
      const totals = computeInvoiceTotals(merged);
      const paymentState = computePaymentState(totals.totalNetToPay, merged.payments);

      const updated = await db.updateInvoice(req.params.id, {
        ...merged,
        ...totals,
        ...paymentState,
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
      const removed = await db.deleteInvoice(req.params.id);
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
      const users = await db.getAllUsers();
      // Allow ADMIN, MANAGER, SUPERVISOR to be approvers
      const approvers = users.filter((u: any) => HR_APPROVER_ROLES.includes(u.role));
      res.json(approvers.map((u: any) => ({ id: u.id, name: u.username, role: u.role })));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET Leave Requests
  app.get('/api/hr/leaves', authenticate, requirePermission('VIEW_HR'), async (req: any, res: any) => {
    try {
      const leaves = await db.getAllLeaveRequests();
      let result = leaves;
      
      if (req.user.role !== 'ADMIN') {
        result = leaves.filter((l: any) => l.userId === req.user.id || l.approverId === req.user.id);
      }
      
      const users = await db.getAllUsers();
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
      const leave = await db.createLeaveRequest({
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
      const requester = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
      await notify(
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
      const leave = await db.getLeaveRequestById(id);
      if (!leave) return res.status(404).json({ error: 'Not found' });
      
      // Ensure the user is the assigned approver or an Admin
      if (leave.approverId !== req.user.id && req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'You are not authorized to approve this request.' });
      }

      if (leave.status !== 'PENDING') return res.status(400).json({ error: 'Request is not pending' });

      // Deduct balance
      const balance = await db.getLeaveBalanceByUserId(leave.userId);
      if (balance.available < leave.duration) {
        return res.status(400).json({ error: 'Insufficient leave balance' });
      }

      // Only `used` moves; `available` is derived from the admin-set entitlement.
      await db.updateLeaveBalance(leave.userId, { used: balance.used + leave.duration });

      const updated = await db.updateLeaveRequest(id, {
        status: 'APPROVED',
        approvedBy: req.user.id,
        approvedAt: new Date().toISOString(),
        approverComment: req.body.comment || '',
        updatedAt: new Date().toISOString()
      });
      await notify(leave.userId, 'LEAVE_DECISION', 'Congé approuvé', `Votre demande de congé du ${leave.startDate} au ${leave.endDate} a été approuvée.`);
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

      const leave = await db.getLeaveRequestById(id);
      if (!leave) return res.status(404).json({ error: 'Not found' });
      
      // Ensure the user is the assigned approver or an Admin
      if (leave.approverId !== req.user.id && req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'You are not authorized to reject this request.' });
      }

      if (leave.status !== 'PENDING') return res.status(400).json({ error: 'Request is not pending' });

      const updated = await db.updateLeaveRequest(id, {
        status: 'REJECTED',
        approvedBy: req.user.id,
        approvedAt: new Date().toISOString(),
        rejectionReason: comment,
        approverComment: comment,
        updatedAt: new Date().toISOString()
      });
      await notify(leave.userId, 'LEAVE_DECISION', 'Congé refusé', `Votre demande de congé du ${leave.startDate} au ${leave.endDate} a été refusée : ${comment}`);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST Cancel Leave
  app.post('/api/hr/leaves/:id/cancel', authenticate, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const leave = await db.getLeaveRequestById(id);
      if (!leave) return res.status(404).json({ error: 'Not found' });
      
      const perms = JSON.parse(req.user.permissions || '[]');
      if (leave.userId !== req.user.id && !perms.includes('MANAGE_LEAVE_REQUESTS')) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (leave.status === 'CANCELLED') return res.status(400).json({ error: 'Already cancelled' });
      
      // If it was approved, we must restore the balance
      if (leave.status === 'APPROVED') {
        const balance = await db.getLeaveBalanceByUserId(leave.userId);
        await db.updateLeaveBalance(leave.userId, {
          used: Math.max(0, balance.used - leave.duration),
        });
      }

      const updated = await db.updateLeaveRequest(id, {
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
      const auths = await db.getAllAbsenceAuthorizations();
      let result = auths;
      
      if (req.user.role !== 'ADMIN') {
        result = auths.filter((a: any) => a.userId === req.user.id || a.approverId === req.user.id);
      }
      
      const users = await db.getAllUsers();
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
      const auth = await db.createAbsenceAuthorization({
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
      const requester = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
      await notify(
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
      const auth = await db.getAbsenceAuthorizationById(id);
      if (!auth) return res.status(404).json({ error: 'Not found' });
      
      if (auth.approverId !== req.user.id && req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'You are not authorized to approve this request.' });
      }

      if (auth.status !== 'PENDING') return res.status(400).json({ error: 'Request is not pending' });

      const updated = await db.updateAbsenceAuthorization(id, {
        status: 'APPROVED',
        approvedBy: req.user.id,
        approvedAt: new Date().toISOString(),
        approverComment: req.body.comment || '',
        updatedAt: new Date().toISOString()
      });
      await notify(auth.userId, 'ABSENCE_DECISION', "Autorisation d'absence approuvée", `Votre demande d'autorisation d'absence du ${auth.date} a été approuvée.`);
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

      const auth = await db.getAbsenceAuthorizationById(id);
      if (!auth) return res.status(404).json({ error: 'Not found' });
      
      if (auth.approverId !== req.user.id && req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'You are not authorized to reject this request.' });
      }

      if (auth.status !== 'PENDING') return res.status(400).json({ error: 'Request is not pending' });

      const updated = await db.updateAbsenceAuthorization(id, {
        status: 'REJECTED',
        approvedBy: req.user.id,
        approvedAt: new Date().toISOString(),
        rejectionReason: comment,
        approverComment: comment,
        updatedAt: new Date().toISOString()
      });
      await notify(auth.userId, 'ABSENCE_DECISION', "Autorisation d'absence refusée", `Votre demande d'autorisation d'absence du ${auth.date} a été refusée : ${comment}`);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST Cancel Auth
  app.post('/api/hr/authorizations/:id/cancel', authenticate, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const auth = await db.getAbsenceAuthorizationById(id);
      if (!auth) return res.status(404).json({ error: 'Not found' });
      
      const perms = JSON.parse(req.user.permissions || '[]');
      if (auth.userId !== req.user.id && !perms.includes('MANAGE_ABSENCE_AUTHORIZATIONS')) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (auth.status === 'CANCELLED') return res.status(400).json({ error: 'Already cancelled' });

      const updated = await db.updateAbsenceAuthorization(id, {
        status: 'CANCELLED',
        updatedAt: new Date().toISOString()
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET Leave Balance
  app.get('/api/hr/balance', authenticate, async (req: any, res: any) => {
    try {
      const balance = await db.getLeaveBalanceByUserId(req.user.id);
      res.json(balance);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------------------------------------------------------
  // Chat (direct messages) API Routes & SSE
  // ---------------------------------------------------------

  // Any authenticated user can message any other user — this is a small
  // internal team tool, not a permission-gated feature like Clients or Cash.
  // Connections are kept per-user so a new message is only pushed to the two
  // people involved, never broadcast to everyone like the time-entries feed.
  const chatSseClients = new Map<number, Set<any>>();

  const sendToUser = (userId: number, payload: any) => {
    const conns = chatSseClients.get(userId);
    if (!conns || conns.size === 0) return;
    const frame = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of conns) res.write(frame);
  };

  // GET /api/messages/contacts — the roster to start a conversation with.
  // Deliberately open to every authenticated user (not gated on MANAGE_USERS),
  // since a collaborator needs to see who they can message.
  app.get('/api/messages/contacts', authenticate, async (req: any, res: any) => {
    try {
      const allUsers = await db.getAllUsers();
      const messages = await db.getAllMessages();
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
      const messages = await db.getAllMessages();
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

      const messages = await db.getAllMessages();
      const thread = messages
        .filter((m: any) =>
          (m.fromUserId === req.user.id && m.toUserId === otherId) ||
          (m.fromUserId === otherId && m.toUserId === req.user.id)
        )
        .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      const changed = await db.markMessagesRead(req.user.id, otherId);
      if (changed > 0) {
        sendToUser(otherId, { type: 'read', by: req.user.id });
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

      const recipient = await db.get('SELECT * FROM users WHERE id = ?', toUserId);
      if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

      const message = await db.createMessage({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fromUserId: req.user.id,
        toUserId,
        body,
        createdAt: new Date().toISOString(),
        readAt: null,
      });

      res.status(201).json(message);
      sendToUser(toUserId, { type: 'message', message });
      sendToUser(req.user.id, { type: 'message', message });
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

    const userId = req.user.id;
    if (!chatSseClients.has(userId)) chatSseClients.set(userId, new Set());
    chatSseClients.get(userId)!.add(res);

    req.on('close', () => {
      const conns = chatSseClients.get(userId);
      if (conns) {
        conns.delete(res);
        if (conns.size === 0) chatSseClients.delete(userId);
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

  const adminUserIds = async () =>
    new Set<number>(
      (await db.getAllUsers()).filter((u: any) => u.role === 'ADMIN').map((u: any) => u.id),
    );

  const enrichEntries = async (entries: any[], forAdmin: boolean) => {
    const users = await db.getAllUsers();
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
    const raw = await db.getAllTimeEntries();
    const adminIds = await adminUserIds();
    // Two payloads only: admins get the cost fields and every row, everyone
    // else gets neither. Both axes split admin/non-admin, so one frame each.
    const cache: Record<string, string> = {};
    for (const client of sseClients) {
      const key = client.isAdmin ? 'admin' : 'plain';
      if (!cache[key]) {
        const visible = visibleEntriesFor(raw, client.isAdmin, adminIds);
        const data = await enrichEntries(visible.slice(0, ENTRIES_PAGE_SIZE), client.isAdmin);
        cache[key] = `data: ${JSON.stringify({ data, total: visible.length })}\n\n`;
      }
      client.res.write(cache[key]);
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

    const client = { res, isAdmin: req.user.role === 'ADMIN' };
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
  const pauseOtherRunningEntries = async (userId: number, keepId: string) => {
    const all = await db.getAllTimeEntries();
    for (const other of all) {
      if (other.userId !== userId || other.id === keepId || other.statut !== 'RUNNING') continue;
      const elapsed = other.lastStartedAt
        ? Math.floor((Date.now() - other.lastStartedAt) / 1000)
        : 0;
      await db.updateTimeEntry(other.id, {
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
      const all = visibleEntriesFor(await db.getAllTimeEntries(), isAdmin, await adminUserIds());
      const limit = Math.min(parseInt(req.query.limit, 10) || ENTRIES_PAGE_SIZE, 1000);
      const offset = parseInt(req.query.offset, 10) || 0;
      const data = await enrichEntries(all.slice(offset, offset + limit), isAdmin);
      res.json({ data, total: all.length, limit, offset });
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
  const createRunningEntryForUser = async (userId: number, fields: any) => {
    const userFull = await db.get('SELECT * FROM users WHERE id = ?', userId);
    const settings = await db.getSettings() || {};
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
      await pauseOtherRunningEntries(userId, id);
    }
    return db.createTimeEntry({
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
      const entry = await createRunningEntryForUser(req.user.id, req.body);
      res.json(entry);
      broadcastTimeEntries(); // Broadcast update
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.put('/api/time-entries/:id', authenticate, async (req: any, res: any) => {
    try {
      const entryId = req.params.id;
      const existing = await db.getTimeEntryById(entryId);
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
        await pauseOtherRunningEntries(existing.userId, entryId);
      }

      const updated = await db.updateTimeEntry(entryId, updates);
      res.json(updated);
      broadcastTimeEntries(); // Broadcast update
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/api/time-entries/:id', authenticate, async (req: any, res: any) => {
    try {
      const entryId = req.params.id;
      const existing = await db.getTimeEntryById(entryId);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      
      const perms = JSON.parse(req.user.permissions || '[]');
      if (existing.userId !== req.user.id && req.user.role !== 'ADMIN' && !perms.includes('DELETE')) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      await db.deleteTimeEntry(entryId);
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
   * The one place a notification is created. `type` picks where the bell
   * sends the user when they click it (see NOTIFICATION_LINK in the client).
   *
   * A `function` declaration, not a `const` arrow — it needs to be callable
   * from the HR routes above, which are defined earlier in this same
   * function body but registered before this point runs. Declarations are
   * hoisted through the whole scope; a `const` would not be.
   */
  async function notify(userId: number, type: string, title: string, body: string) {
    await db.createNotification({
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId,
      type,
      title,
      body,
      readAt: null,
      createdAt: new Date().toISOString(),
    });
  }

  const NOTIFICATIONS_PAGE_SIZE = 50;

  app.get('/api/notifications', authenticate, async (req: any, res: any) => {
    try {
      const mine = (await db.getAllNotifications()).filter((n: any) => n.userId === req.user.id);
      const unreadCount = mine.filter((n: any) => !n.readAt).length;
      res.json({ items: mine.slice(0, NOTIFICATIONS_PAGE_SIZE), unreadCount });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.put('/api/notifications/:id/read', authenticate, async (req: any, res: any) => {
    try {
      const existing = await db.getAllNotifications();
      const n = existing.find((x: any) => x.id === req.params.id);
      // Not found *or belongs to someone else* both read as 404 — a
      // notification id must never let one user probe another's inbox.
      if (!n || n.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });
      const updated = await db.updateNotification(req.params.id, { readAt: n.readAt || new Date().toISOString() });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.put('/api/notifications/read-all', authenticate, async (req: any, res: any) => {
    try {
      const mine = (await db.getAllNotifications()).filter((n: any) => n.userId === req.user.id && !n.readAt);
      const now = new Date().toISOString();
      await Promise.allSettled(mine.map((n: any) => db.updateNotification(n.id, { readAt: now })));
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
      const users = await db.getAllUsers();
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

  app.post('/api/task-assignments', authenticate, requirePermission('ASSIGN_TASKS'), async (req: any, res: any) => {
    try {
      const { assignedToUserId, client, clientId, pole, serviceId, taskType, taskTypeId, description } = req.body;
      const targetId = Number(assignedToUserId);
      if (!Number.isFinite(targetId)) return res.status(400).json({ error: 'assignedToUserId requis' });
      if (!String(pole || '').trim()) return res.status(400).json({ error: 'La mission est requise' });

      const target = await db.get('SELECT * FROM users WHERE id = ?', targetId);
      if (!target) return res.status(404).json({ error: 'Collaborateur introuvable' });

      const assigner = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
      const assignment = await db.createTaskAssignment({
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
      });

      await notify(
        targetId,
        'TASK_ASSIGNED',
        'Nouvelle tâche assignée',
        `${assignment.assignedByName} vous a assigné « ${assignment.pole}${assignment.taskType ? ' · ' + assignment.taskType : ''} »` +
          (assignment.client ? ` pour ${assignment.client}` : ''),
      );

      res.status(201).json(assignment);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** Pending assignments for the logged-in user — the dashboard widget. */
  app.get('/api/task-assignments/mine', authenticate, async (req: any, res: any) => {
    try {
      const mine = (await db.getAllTaskAssignments())
        .filter((a: any) => a.assignedToUserId === req.user.id && a.status === 'PENDING');
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
      const assignment = await db.getTaskAssignmentById(req.params.id);
      if (!assignment) return res.status(404).json({ error: 'Not found' });
      if (assignment.assignedToUserId !== req.user.id) {
        return res.status(403).json({ error: 'Cette tâche ne vous est pas assignée' });
      }
      if (assignment.status !== 'PENDING') {
        return res.status(409).json({ error: 'Cette tâche a déjà été démarrée ou annulée' });
      }

      const entry = await createRunningEntryForUser(req.user.id, {
        client: assignment.client,
        clientId: assignment.clientId,
        pole: assignment.pole,
        serviceId: assignment.serviceId,
        taskType: assignment.taskType,
        taskTypeId: assignment.taskTypeId,
        description: assignment.description,
        statut: 'RUNNING',
      });

      const updated = await db.updateTaskAssignment(assignment.id, {
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

  /** Cancels a pending assignment. A started one is real history — left alone. */
  app.delete('/api/task-assignments/:id', authenticate, requirePermission('ASSIGN_TASKS'), async (req: any, res: any) => {
    try {
      const assignment = await db.getTaskAssignmentById(req.params.id);
      if (!assignment) return res.status(404).json({ error: 'Not found' });
      if (assignment.status !== 'PENDING') {
        return res.status(400).json({ error: 'Seule une tâche en attente peut être annulée' });
      }
      await db.deleteTaskAssignment(req.params.id);
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

  /** Number of days in `year`/`month` (0-indexed month), for day-of-month clamping. */
  const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

  /**
   * The three recurrence patterns the cahier des charges' own examples use.
   * Returns the smallest due date >= `seed`. Regeneration passes the previous
   * due date + 1 day as the seed, so it always lands on the *next* cycle.
   */
  const computeDueDate = (rule: string, seed: Date): Date => {
    let m = /^MONTHLY\(day=(\d+)\)$/.exec(rule);
    if (m) {
      const day = Number(m[1]);
      let y = seed.getFullYear(), mo = seed.getMonth();
      let candidate = new Date(y, mo, Math.min(day, daysInMonth(y, mo)));
      if (candidate < seed) {
        mo += 1; if (mo > 11) { mo = 0; y += 1; }
        candidate = new Date(y, mo, Math.min(day, daysInMonth(y, mo)));
      }
      return candidate;
    }
    m = /^QUARTERLY(?:\(day=(\d+)\))?$/.exec(rule);
    if (m) {
      const day = Number(m[1] || 28);
      // Due the month after each calendar quarter ends: Jan, Apr, Jul, Oct.
      const dueMonths = [0, 3, 6, 9];
      const y = seed.getFullYear();
      const mo = dueMonths.find(dm => new Date(y, dm, Math.min(day, daysInMonth(y, dm))) >= seed);
      if (mo === undefined) return new Date(y + 1, 0, Math.min(day, daysInMonth(y + 1, 0)));
      return new Date(y, mo, Math.min(day, daysInMonth(y, mo)));
    }
    m = /^ANNUAL\(month=(\d+),day=(\d+)\)$/.exec(rule);
    if (m) {
      const month = Number(m[1]) - 1, day = Number(m[2]);
      let y = seed.getFullYear();
      let candidate = new Date(y, month, Math.min(day, daysInMonth(y, month)));
      if (candidate < seed) { y += 1; candidate = new Date(y, month, Math.min(day, daysInMonth(y, month))); }
      return candidate;
    }
    throw new Error('Règle de récurrence non reconnue: ' + rule);
  };

  /** §3.6 of the cahier des charges — recalculated on every read, never stored. */
  const deadlineInstanceStatus = (instance: any): 'realisee' | 'en_retard' | 'a_venir' | 'en_cours' => {
    if (instance.completedAt) return 'realisee';
    const due = new Date(instance.dueDate + 'T00:00:00');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (due < today) return 'en_retard';
    const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
    if (diffDays <= (typeof instance.leadTimeDays === 'number' ? instance.leadTimeDays : 7)) return 'a_venir';
    return 'en_cours';
  };

  const formatDateISO = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  /**
   * Lazily ensures each already-activated (client, template) pair has exactly
   * one open (uncompleted) instance. Never generates further ahead than that —
   * a client's declaration going unpaid for a year must not silently pile up
   * twelve rows. Scoped to `clientId` when given, otherwise runs over every
   * activated pair (bounded by clients × active templates, not by history).
   */
  const ensureDeadlineInstances = async (clientId?: number) => {
    const templates = await db.getAllDeadlineTemplates();
    const templatesById = new Map(templates.map((t: any) => [t.id, t]));
    let all = await db.getAllClientDeadlineInstances();
    if (clientId != null) all = all.filter((i: any) => i.clientId === clientId);

    const groups = new Map<string, any[]>();
    for (const inst of all) {
      const key = `${inst.clientId}:${inst.templateId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(inst);
    }

    for (const [, instances] of groups) {
      const hasOpen = instances.some((i: any) => !i.completedAt);
      if (hasOpen) continue;
      const latest = instances.reduce((a: any, b: any) => (a.dueDate > b.dueDate ? a : b));
      const template = templatesById.get(latest.templateId);
      if (!template || !template.isActive) continue;
      const seed = new Date(latest.dueDate + 'T00:00:00');
      seed.setDate(seed.getDate() + 1);
      const dueDate = computeDueDate(template.recurrenceRule, seed);
      await db.createClientDeadlineInstance({
        id: genId('deadline'),
        clientId: latest.clientId,
        templateId: template.id,
        name: template.name,
        leadTimeDays: template.leadTimeDays,
        dueDate: formatDateISO(dueDate),
        completedAt: null,
        completedBy: null,
        createdAt: new Date().toISOString(),
      });
    }
  };

  // --- Resource templates (documents à fournir / procédures) ---

  app.get('/api/resource-templates', authenticate, requirePermission('VIEW_RESOURCES'), async (req: any, res: any) => {
    try {
      let templates = await db.getAllResourceTemplates();
      if (req.query.type) templates = templates.filter((t: any) => t.type === req.query.type);
      res.json(templates);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/resource-template-items', authenticate, requirePermission('VIEW_RESOURCES'), async (req: any, res: any) => {
    try {
      res.json(await db.getAllResourceTemplateItems());
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
      const template = await db.createResourceTemplate({
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
      const template = await db.getResourceTemplateById(req.params.id);
      if (!template) return res.status(404).json({ error: 'Not found' });
      const { name, sector, isSequential, isActive } = req.body;
      const updates: any = {};
      if (name !== undefined) updates.name = String(name).trim();
      if (sector !== undefined) updates.sector = sector ? String(sector).trim() : null;
      if (isSequential !== undefined) updates.isSequential = !!isSequential;
      if (isActive !== undefined) updates.isActive = !!isActive;
      const updated = await db.updateResourceTemplate(req.params.id, updates);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/api/resource-templates/:id', authenticate, requirePermission('MANAGE_RESOURCES'), async (req: any, res: any) => {
    try {
      const template = await db.getResourceTemplateById(req.params.id);
      if (!template) return res.status(404).json({ error: 'Not found' });
      await db.deleteResourceTemplate(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/resource-template-items', authenticate, requirePermission('MANAGE_RESOURCES'), async (req: any, res: any) => {
    try {
      const { templateId, label } = req.body;
      const template = await db.getResourceTemplateById(templateId);
      if (!template) return res.status(404).json({ error: 'Modèle introuvable' });
      if (!String(label || '').trim()) return res.status(400).json({ error: 'Le libellé est requis' });
      const existing = (await db.getAllResourceTemplateItems()).filter((i: any) => i.templateId === templateId);
      const item = await db.createResourceTemplateItem({
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
      const updated = await db.updateResourceTemplateItem(req.params.id, updates);
      if (!updated) return res.status(404).json({ error: 'Not found' });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/api/resource-template-items/:id', authenticate, requirePermission('MANAGE_RESOURCES'), async (req: any, res: any) => {
    try {
      const ok = await db.deleteResourceTemplateItem(req.params.id);
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
      const template = await db.getResourceTemplateById(templateId);
      if (!template) return res.status(404).json({ error: 'Modèle introuvable' });
      const client = await db.getClientById(Number(clientId));
      if (!client) return res.status(404).json({ error: 'Client introuvable' });

      const instance = await db.createClientResourceInstance({
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

      const items = (await db.getAllResourceTemplateItems())
        .filter((i: any) => i.templateId === template.id)
        .sort((a: any, b: any) => a.sortOrder - b.sortOrder);
      for (const item of items) {
        await db.createClientResourceItemStatus({
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
      const instances = (await db.getAllClientResourceInstances()).filter((i: any) => i.clientId === clientId);
      const allStatuses = await db.getAllClientResourceItemStatuses();
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
      const ok = await db.deleteClientResourceInstance(req.params.id);
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
      const allStatuses = await db.getAllClientResourceItemStatuses();
      const item = allStatuses.find((s: any) => s.id === req.params.id);
      if (!item) return res.status(404).json({ error: 'Not found' });

      if (done) {
        const instance = await db.getClientResourceInstanceById(item.instanceId);
        if (instance?.isSequential) {
          const blocked = allStatuses.some((s: any) =>
            s.instanceId === item.instanceId && s.sortOrder < item.sortOrder && !s.done,
          );
          if (blocked) return res.status(409).json({ error: 'Les étapes précédentes doivent être résolues d\'abord.' });
        }
      }

      const updated = await db.updateClientResourceItemStatus(req.params.id, {
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
        db.getAllClientResourceInstances(), db.getAllClientResourceItemStatuses(), db.getAllClients(),
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

  app.get('/api/useful-links', authenticate, requirePermission('VIEW_RESOURCES'), async (_req: any, res: any) => {
    try {
      res.json(await db.getAllUsefulLinks());
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
      const existing = await db.getAllUsefulLinks();
      const link = await db.createUsefulLink({
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
      const updated = await db.updateUsefulLink(req.params.id, updates);
      if (!updated) return res.status(404).json({ error: 'Not found' });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/api/useful-links/:id', authenticate, requirePermission('MANAGE_RESOURCES'), async (req: any, res: any) => {
    try {
      const ok = await db.deleteUsefulLink(req.params.id);
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // --- Échéances ---

  app.get('/api/deadline-templates', authenticate, requirePermission('VIEW_RESOURCES'), async (_req: any, res: any) => {
    try {
      res.json(await db.getAllDeadlineTemplates());
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/deadline-templates', authenticate, requirePermission('MANAGE_RESOURCES'), async (req: any, res: any) => {
    try {
      const { name, recurrenceRule, leadTimeDays, sector, missionId, taskTypeId } = req.body;
      if (!String(name || '').trim()) return res.status(400).json({ error: 'Le nom est requis' });
      try { computeDueDate(recurrenceRule, new Date()); } catch {
        return res.status(400).json({ error: 'Règle de récurrence invalide (attendu: MONTHLY(day=N), QUARTERLY ou ANNUAL(month=M,day=N))' });
      }
      const template = await db.createDeadlineTemplate({
        id: genId('dtpl'),
        name: String(name).trim(),
        recurrenceRule,
        leadTimeDays: typeof leadTimeDays === 'number' ? leadTimeDays : 7,
        sector: sector || null,
        missionId: missionId != null ? Number(missionId) : null,
        taskTypeId: taskTypeId != null ? Number(taskTypeId) : null,
        isActive: true,
        isSystem: false,
      });
      res.status(201).json(template);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.put('/api/deadline-templates/:id', authenticate, requirePermission('MANAGE_RESOURCES'), async (req: any, res: any) => {
    try {
      const template = await db.getDeadlineTemplateById(req.params.id);
      if (!template) return res.status(404).json({ error: 'Not found' });
      if (template.isSystem) return res.status(403).json({ error: 'Un modèle système ne peut pas être modifié.' });
      const { name, recurrenceRule, leadTimeDays, isActive } = req.body;
      const updates: any = {};
      if (name !== undefined) updates.name = String(name).trim();
      if (recurrenceRule !== undefined) {
        try { computeDueDate(recurrenceRule, new Date()); } catch {
          return res.status(400).json({ error: 'Règle de récurrence invalide' });
        }
        updates.recurrenceRule = recurrenceRule;
      }
      if (leadTimeDays !== undefined) updates.leadTimeDays = Number(leadTimeDays);
      if (isActive !== undefined) updates.isActive = !!isActive;
      const updated = await db.updateDeadlineTemplate(req.params.id, updates);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/api/deadline-templates/:id', authenticate, requirePermission('MANAGE_RESOURCES'), async (req: any, res: any) => {
    try {
      const template = await db.getDeadlineTemplateById(req.params.id);
      if (!template) return res.status(404).json({ error: 'Not found' });
      if (template.isSystem) return res.status(403).json({ error: 'Un modèle système ne peut pas être supprimé.' });
      await db.deleteDeadlineTemplate(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** §2.4 flow step 1 — activates a recurring deadline model for one client. */
  app.post('/api/client-deadlines/activate', authenticate, requirePermission('VIEW_RESOURCES'), async (req: any, res: any) => {
    try {
      const { clientId, templateId } = req.body;
      if (clientId == null) return res.status(400).json({ error: 'Client requis' });
      const template = await db.getDeadlineTemplateById(templateId);
      if (!template) return res.status(404).json({ error: 'Modèle introuvable' });
      const client = await db.getClientById(Number(clientId));
      if (!client) return res.status(404).json({ error: 'Client introuvable' });

      const already = (await db.getAllClientDeadlineInstances())
        .some((i: any) => i.clientId === Number(clientId) && i.templateId === template.id && !i.completedAt);
      if (already) return res.status(409).json({ error: 'Cette échéance est déjà activée pour ce client.' });

      const instance = await db.createClientDeadlineInstance({
        id: genId('deadline'),
        clientId: Number(clientId),
        templateId: template.id,
        name: template.name,
        leadTimeDays: template.leadTimeDays,
        dueDate: formatDateISO(computeDueDate(template.recurrenceRule, new Date())),
        completedAt: null,
        completedBy: null,
        createdAt: new Date().toISOString(),
      });
      res.status(201).json(instance);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** Échéances for one client — the "Suivi & Ressources" tab. */
  app.get('/api/client-deadlines', authenticate, requirePermission('VIEW_RESOURCES'), async (req: any, res: any) => {
    try {
      const clientId = req.query.clientId != null ? Number(req.query.clientId) : null;
      if (clientId == null) return res.status(400).json({ error: 'clientId requis' });
      await ensureDeadlineInstances(clientId);
      const instances = (await db.getAllClientDeadlineInstances()).filter((i: any) => i.clientId === clientId);
      res.json(instances.map((i: any) => ({ ...i, status: deadlineInstanceStatus(i) })));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** §4.4 — vision globale portefeuille. Same team-viewer gate as the KPI dashboard. */
  app.get('/api/deadlines/portfolio', authenticate, requirePermission('VIEW_RESOURCES'), async (req: any, res: any) => {
    try {
      if (!DASHBOARD_ROLES.includes(req.user.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      await ensureDeadlineInstances();
      const [instances, clients] = await Promise.all([db.getAllClientDeadlineInstances(), db.getAllClients()]);
      const clientsById = new Map(clients.map((c: any) => [c.id, c]));
      res.json(instances.map((i: any) => ({
        ...i,
        status: deadlineInstanceStatus(i),
        clientName: clientsById.get(i.clientId)?.name ?? 'Client supprimé',
      })));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** Toggles completion — the one thing a collaborator or manager does to an échéance. */
  app.put('/api/client-deadlines/:id/complete', authenticate, requirePermission('VIEW_RESOURCES'), async (req: any, res: any) => {
    try {
      const { completed } = req.body;
      const updated = await db.updateClientDeadlineInstance(req.params.id, {
        completedAt: completed ? new Date().toISOString() : null,
        completedBy: completed ? req.user.id : null,
      });
      if (!updated) return res.status(404).json({ error: 'Not found' });
      res.json({ ...updated, status: deadlineInstanceStatus(updated) });
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
