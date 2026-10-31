/**
 * Creates a separate, self-contained demo company — login `demo` / `demo` —
 * filled with one month of realistic activity, so the dashboard has
 * something to analyse:
 *
 *   - 4 team members, every payroll and employer-cost field filled in;
 *   - 10 fictitious clients, with the same custom columns as the platform
 *     admin's own client file (values are invented, never copied);
 *   - 50 completed tasks spread over the month, a month of attendance
 *     (pointage de présence), one bulletin de paie each;
 *   - invoices, client payments and cash movements, a leave and an absence;
 *   - filled échéances and procedures in progress;
 *   - 10 client-portal accounts, one per client.
 *
 * The month is the current calendar month, the one the dashboard opens on;
 * SEED_MONTH=YYYY-MM picks another.
 *
 * Same rule as seed-demo-data.ts: everything that carries a business rule —
 * employer cost, task duration, invoice cascade and numbering, payslip
 * IRPP/CSS/CNSS, leave balances — is created through the running app's HTTP
 * API, so the numbers come from the server's own code and cannot drift from
 * it. Only two things go straight to the database, because no route can
 * produce them: attendance records for past days (check-in and check-out
 * always stamp "now"), and the password `demo` itself (every route requires
 * at least six characters). That is phase 2.
 *
 * Usage, against the deployed PostgreSQL (one run does both phases):
 *
 *   SEED_BASE_URL="https://www.taches-and-cash.com" \
 *   SEED_ADMIN_USERNAME="…" SEED_ADMIN_PASSWORD="…"   # a platform admin
 *   DATABASE_URL="postgresql://…" \
 *   npm run db:seed-demo-account
 *
 * Locally, on the JSON file: phase 1 needs the app running, and phase 2 must
 * run with it **stopped** — the server keeps the file in memory and would
 * overwrite what phase 2 writes on its next save:
 *
 *   npm run dev                                   # terminal 1
 *   npm run db:seed-demo-account                  # terminal 2 — phase 1
 *   (stop npm run dev)
 *   npm run db:seed-demo-account -- --finish      # phase 2
 *
 * Not idempotent: it stops at once if a `demo` user already exists. To start
 * over, delete the « Démo » company from the platform console.
 */

import bcrypt from 'bcryptjs';
import { initDb } from '../src/server/database.js';

const BASE_URL = process.env.SEED_BASE_URL || 'http://localhost:3000';
const ADMIN_USERNAME = process.env.SEED_ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'admin123';

const DEMO_USERNAME = 'demo';
const DEMO_PASSWORD = 'demo';
/** What phase 1 logs in with until phase 2 sets `demo` — the API refuses anything shorter than six characters. */
const DEMO_TEMP_PASSWORD = 'demo-seed-1234';
const DEMO_EMAIL = 'demo@example.com';
const TEAM_PASSWORD = 'demo1234';
const PORTAL_PASSWORD = 'demo1234';

type Json = Record<string, any>;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

async function api(path: string, opts: { method?: string; token?: string; body?: Json } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${opts.method || 'GET'} ${path} -> ${res.status}: ${body?.error || JSON.stringify(body)}`);
  }
  return body;
}

async function login(username: string, password: string): Promise<string> {
  const body = await api('/api/login', { method: 'POST', body: { username, password } });
  return body.token;
}

/** Seeded PRNG, so two runs produce the same month rather than a different one each time. */
let seed = 20261031;
function rand(): number {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const pad = (n: number) => String(n).padStart(2, '0');
const hm = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const fr = (y: number, m: number, d: number) => `${pad(d)}/${pad(m)}/${y}`;

/** Tunisian fixed-date public holidays (MM-DD) — nobody works them, so no task or attendance lands on one. */
const FIXED_HOLIDAYS = ['01-01', '01-14', '03-20', '04-09', '05-01', '07-25', '08-13', '10-15', '12-17'];

/** Today's civil date in Tunis — the cabinet's clock, never the machine's. */
function todayTunis(): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const get = (t: string) => Number(parts.find(p => p.type === t)!.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** The month seeded: SEED_MONTH=YYYY-MM, else the current one — what the dashboard opens on. */
function targetMonth() {
  const today = todayTunis();
  const env = process.env.SEED_MONTH;
  const [y, m] = env && /^\d{4}-\d{2}$/.test(env) ? env.split('-').map(Number) : [today.y, today.m];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  // Never past today: a task dated tomorrow would be a lie on a dashboard
  // that stops at today.
  const isCurrent = y === today.y && m === today.m;
  const upTo = isCurrent ? today.d : lastDay;
  const workdays: number[] = [];
  for (let d = 1; d <= upTo; d++) {
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (FIXED_HOLIDAYS.includes(`${pad(m)}-${pad(d)}`)) continue;
    workdays.push(d);
  }
  const holidaysInMonth = FIXED_HOLIDAYS.filter(h => h.startsWith(pad(m)) && Number(h.slice(3)) <= upTo).length;
  return { y, m, workdays, holidaysInMonth, upTo };
}

// ---------------------------------------------------------------------------
// The team
// ---------------------------------------------------------------------------

const CHARGES = { cnss: 17.07, tfp: 2.0, foprolos: 1.0, accidentTravail: 0.5 };
const COLLAB_PERMS = ['VIEW', 'EDIT', 'MODIFY', 'VIEW_HR', 'CREATE_LEAVE_REQUEST', 'CREATE_ABSENCE_AUTHORIZATION', 'CREATE_LOAN_REQUEST', 'VIEW_CLIENTS', 'VIEW_RESOURCES'];
const SUPERVISOR_PERMS = [...COLLAB_PERMS, 'MANAGE_LEAVE_REQUESTS', 'MANAGE_ABSENCE_AUTHORIZATIONS', 'MANAGE_LOANS_ADVANCES', 'ASSIGN_TASKS', 'EDIT_CLIENTS', 'VIEW_CASH'];

const TEAM = [
  {
    username: 'demo.amine', role: 'SUPERVISEUR', permissions: SUPERVISOR_PERMS,
    salaireBrut: 2100, primesFraisNonCotisables: 120, soldeConge: 24,
    matricule: 'DEM-001', numCin: '07451236', numCnss: '3304512369', qualification: 'Chef de mission',
    departement: 'Audit', banque: 'BIAT', numeroCompte: 'TN59 0800 1000 0000 4512 3601',
    situationFamiliale: 'Marié(e)', nombreEnfants: 2, categorie: 'Cadre supérieur', echelon: '5', salHeure: 12.13,
    paieEnfantsEtudiants: 1, paieParentsACharge: 1, paieAssuranceVie: 600, paieCEA: 0, paieEnfantsInfirmes: 0,
  },
  {
    username: 'demo.sarra', role: 'COLLABORATOR', permissions: COLLAB_PERMS,
    salaireBrut: 1450, primesFraisNonCotisables: 70, soldeConge: 21,
    matricule: 'DEM-002', numCin: '09874521', numCnss: '3309874528', qualification: 'Comptable confirmée',
    departement: 'Comptabilité', banque: 'Attijari Bank', numeroCompte: 'TN59 0400 2000 0000 9874 5202',
    situationFamiliale: 'Mariée', nombreEnfants: 1, categorie: 'Cadre', echelon: '3', salHeure: 8.37,
    paieEnfantsEtudiants: 0, paieParentsACharge: 0, paieAssuranceVie: 0, paieCEA: 1200, paieEnfantsInfirmes: 0,
  },
  {
    username: 'demo.mehdi', role: 'COLLABORATOR', permissions: COLLAB_PERMS,
    salaireBrut: 1250, primesFraisNonCotisables: 50, soldeConge: 21,
    matricule: 'DEM-003', numCin: '11236985', numCnss: '3311236987', qualification: 'Fiscaliste',
    departement: 'Fiscalité', banque: 'UIB', numeroCompte: 'TN59 1200 3000 0000 1123 6903',
    situationFamiliale: 'Célibataire', nombreEnfants: 0, categorie: 'Agent de maîtrise', echelon: '2', salHeure: 7.21,
    paieEnfantsEtudiants: 0, paieParentsACharge: 2, paieAssuranceVie: 0, paieCEA: 0, paieEnfantsInfirmes: 0,
  },
  {
    username: 'demo.ines', role: 'STAGIAIRE', permissions: COLLAB_PERMS,
    salaireBrut: 650, primesFraisNonCotisables: 0, soldeConge: 12,
    matricule: 'DEM-004', numCin: '13589647', numCnss: '3313589641', qualification: 'Stagiaire comptable',
    departement: 'Comptabilité', banque: 'BH Bank', numeroCompte: 'TN59 1400 4000 0000 1358 9604',
    situationFamiliale: 'Célibataire', nombreEnfants: 0, categorie: 'Stagiaire', echelon: '-', salHeure: 3.75,
    paieEnfantsEtudiants: 0, paieParentsACharge: 0, paieAssuranceVie: 0, paieCEA: 0, paieEnfantsInfirmes: 0,
  },
];
const SHIFT = { shiftStart: '08:00', shiftEnd: '17:00', breakMinutes: 60 };

// ---------------------------------------------------------------------------
// The clients — fictitious names, invented values
// ---------------------------------------------------------------------------

const CLIENTS = [
  { name: 'Atlas Négoce SARL', forme: 'SARL', activite: 'Commerce de gros', city: 'Tunis', gerant: 'Karim Ben Ammar', weight: 8, nonFacturable: false },
  { name: 'Carthage Digital SUARL', forme: 'SUARL', activite: 'Services informatiques', city: 'Ariana', gerant: 'Leila Chaabane', weight: 6, nonFacturable: false },
  { name: 'Medina Bâtiment SA', forme: 'SA', activite: 'Bâtiment et travaux publics', city: 'Ben Arous', gerant: 'Hatem Jaziri', weight: 9, nonFacturable: false },
  { name: 'Olivia Agro SARL', forme: 'SARL', activite: 'Huilerie', city: 'Sfax', gerant: 'Mounir Ellouze', weight: 4, nonFacturable: false },
  { name: 'Sahel Logistique SUARL', forme: 'SUARL', activite: 'Transport de marchandises', city: 'Sousse', gerant: 'Rania Gharsalli', weight: 5, nonFacturable: false },
  { name: 'Cabinet Dentaire Dr. Mansour', forme: 'Personne physique', activite: 'Profession médicale', city: 'Nabeul', gerant: 'Dr. Walid Mansour', weight: 3, nonFacturable: false },
  { name: 'Jasmin Événements SARL', forme: 'SARL', activite: 'Organisation d\'événements', city: 'La Marsa', gerant: 'Amel Kchouk', weight: 4, nonFacturable: false },
  { name: 'Nour Pharma Distribution SA', forme: 'SA', activite: 'Distribution pharmaceutique', city: 'Monastir', gerant: 'Slim Hamdi', weight: 5, nonFacturable: false },
  { name: 'Djerba Hôtellerie SA', forme: 'SA', activite: 'Hôtellerie', city: 'Djerba', gerant: 'Faten Ben Yedder', weight: 4, nonFacturable: false },
  { name: 'Association Sport Pour Tous', forme: 'Association', activite: 'Associatif', city: 'Bizerte', gerant: 'Nizar Toumi', weight: 2, nonFacturable: true },
];

/** Used when the platform admin's own client file has no custom columns to copy. */
const FALLBACK_COLUMNS = ['Numéro', 'Forme juridique', 'Gérant', 'Activité', 'Régime fiscal', 'N° RNE', 'N° CNSS employeur', 'Date de création', 'Honoraires mensuels'];

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * An invented value for one custom column, guessed from its name. The admin's
 * own values are never read: this demo has a four-letter password, and
 * anything copied into it would be readable by anyone who tries it.
 */
function valueForColumn(column: string, c: typeof CLIENTS[number], i: number): string {
  const k = fold(column);
  const num = (len: number) => Array.from({ length: len }, () => randInt(0, 9)).join('');
  if (/^n$|^no$|^n°$|numero$|^num$/.test(k)) return String(i + 1);
  if (/matricule|^mf$|identifiant fiscal/.test(k)) return `${num(7)}${'ABCDEFGHJKLMNPQRSTVWXYZ'[i]}/A/M/000`;
  if (/rne|registre/.test(k)) return `B0${num(7)}20${randInt(10, 24)}`;
  if (/cnss/.test(k)) return num(8);
  if (/gerant|dirigeant|responsable|contact|representant/.test(k)) return c.gerant;
  if (/tel|phone|gsm|mobile|portable/.test(k)) return `+216 ${randInt(20, 99)} ${num(3)} ${num(3)}`;
  if (/mail/.test(k)) return `contact@${fold(c.name).replace(/[^a-z]/g, '').slice(0, 14)}.tn`;
  if (/date/.test(k)) return `${pad(randInt(1, 28))}/${pad(randInt(1, 12))}/${randInt(2008, 2022)}`;
  if (/activit|secteur|objet/.test(k)) return c.activite;
  if (/forme|juridique/.test(k)) return c.forme;
  if (/regime|tva/.test(k)) return pick(['Réel', 'Réel', 'Forfaitaire']);
  if (/adresse|siege/.test(k)) return `${randInt(2, 180)} rue ${pick(['de Marseille', 'Habib Bourguiba', 'de la Liberté', 'Ibn Khaldoun', 'de Palestine'])}`;
  if (/ville|gouvernorat|region/.test(k)) return c.city;
  if (/capital/.test(k)) return String(pick([1000, 5000, 10000, 50000, 100000]));
  if (/honoraire|tarif|montant|forfait|prix/.test(k)) return String(pick([150, 200, 250, 300, 400, 600]));
  if (/banque/.test(k)) return pick(['BIAT', 'STB', 'BNA', 'Attijari Bank', 'Amen Bank']);
  if (/rib|iban|compte/.test(k)) return `TN59 ${num(4)} ${num(4)} ${num(4)} ${num(4)} ${num(4)}`;
  if (/statut|etat/.test(k)) return 'Actif';
  if (/collaborateur|charge|suivi/.test(k)) return pick(['Amine', 'Sarra', 'Mehdi']);
  if (/observ|remarque|note|comment/.test(k)) return pick(['Dossier à jour', 'Relancer pour les pièces', 'RAS']);
  return pick(['Oui', 'Non']);
}

// ---------------------------------------------------------------------------
// Phase 1 — through the API
// ---------------------------------------------------------------------------

async function phaseApi() {
  const month = targetMonth();
  console.log(`Phase 1 — via l'API ${BASE_URL}, mois ${pad(month.m)}/${month.y} (${month.workdays.length} jours ouvrés).\n`);

  const platformToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  const platformMe = await api('/api/me', { token: platformToken });
  if (!platformMe.isPlatformAdmin) throw new Error(`${ADMIN_USERNAME} n'est pas administrateur de la plateforme.`);

  // Refuse to run twice: a second « demo » company would be impossible to
  // tell apart from the first.
  const companies: any[] = await api('/api/platform/companies', { token: platformToken });
  for (const c of companies) {
    const users: any[] = await api(`/api/platform/companies/${c.id}/users`, { token: platformToken });
    if (users.some(u => String(u.username).toLowerCase() === DEMO_USERNAME)) {
      throw new Error(`Un utilisateur « ${DEMO_USERNAME} » existe déjà (entreprise « ${c.name} »). Supprimez-la depuis la console plateforme pour recommencer.`);
    }
  }

  // The client columns to reproduce: the platform admin's own client file.
  const adminColumns: string[] = await api('/api/clients/fields', { token: platformToken }).catch(() => []);
  const columns = adminColumns.length > 0 ? adminColumns : FALLBACK_COLUMNS;
  console.log(`Colonnes clients reprises ${adminColumns.length > 0 ? 'du compte admin' : '(aucune chez l\'admin — jeu par défaut)'} : ${columns.join(', ')}`);

  // 1. The company: signup like any visitor, then confirmed as paid.
  await api('/api/signup', {
    method: 'POST',
    body: {
      companyName: 'Démo — Cabinet Tâches & Cash', contactName: 'Compte de démonstration',
      contactEmail: DEMO_EMAIL, phone: '+216 70 000 000',
      password: DEMO_TEMP_PASSWORD, confirmPassword: DEMO_TEMP_PASSWORD,
      plan: 'COMPLET', seats: 5, secteur: 'CABINET',
    },
  });
  let token = await login(DEMO_EMAIL, DEMO_TEMP_PASSWORD);
  const me = await api('/api/me', { token });
  const companyId = me.company.id;
  await api(`/api/platform/companies/${companyId}/confirm`, { method: 'POST', token: platformToken, body: { plan: 'COMPLET' } });
  await api(`/api/platform/companies/${companyId}`, {
    method: 'PUT', token: platformToken,
    body: {
      name: 'Démo — Cabinet Tâches & Cash', contactName: 'Compte de démonstration', contactEmail: DEMO_EMAIL,
      phone: '+216 70 000 000', seatLimit: '5', portalSeatLimit: '10', trialEndsAt: '', subscriptionEndsAt: '',
    },
  });
  await api(`/api/platform/companies/${companyId}/users/${me.id}`, { method: 'PUT', token: platformToken, body: { username: DEMO_USERNAME } });
  token = await login(DEMO_USERNAME, DEMO_TEMP_PASSWORD);
  console.log(`Entreprise créée (${companyId}), abonnement Complet actif, administrateur « ${DEMO_USERNAME} ».`);

  // Issuer block, so invoices and payslips carry a header.
  await api('/api/cash/company', {
    method: 'PUT', token,
    body: {
      company: {
        name: 'Cabinet Démo Tâches & Cash', address: '12 avenue Habib Bourguiba, 1001 Tunis',
        taxId: '1234567X/A/M/000', phone: '+216 70 000 000', email: DEMO_EMAIL, numeroEmployeur: '3300112233',
      },
      banks: [{ id: 'bank-1', name: 'BIAT', rib: '08 001 0000001234567 89', iban: 'TN59 0800 1000 0000 1234 5678', swift: 'BIATTNTT' }],
    },
  }).catch(e => console.log(`  (bloc émetteur non renseigné : ${e.message})`));

  // 2. The team.
  const team: (typeof TEAM[number] & { id: number; token: string })[] = [];
  for (const t of TEAM) {
    const created = await api('/api/users', {
      method: 'POST', token,
      body: { ...t, password: TEAM_PASSWORD, regimeHoraire: 40, ...CHARGES, ...SHIFT },
    });
    team.push({ ...t, id: created.id, token: await login(t.username, TEAM_PASSWORD) });
  }
  console.log(`Équipe : ${team.map(t => `${t.username} (${t.role})`).join(', ')}.`);

  // 3. Clients, with every native field and the admin's custom columns.
  const clients: (typeof CLIENTS[number] & { id: number })[] = [];
  for (const [i, c] of CLIENTS.entries()) {
    const customFields: Record<string, string> = {};
    for (const col of columns) customFields[col] = valueForColumn(col, c, i);
    const slug = fold(c.name).replace(/[^a-z]/g, '').slice(0, 14);
    const created = await api('/api/clients', {
      method: 'POST', token,
      body: {
        name: c.name, type: c.forme === 'Personne physique' ? 'Individual' : 'Company',
        email: `contact@${slug}.tn`, phone: `+216 7${randInt(0, 9)} ${randInt(100, 999)} ${randInt(100, 999)}`,
        address: `${randInt(2, 180)} avenue de la République`, city: c.city, country: 'Tunisie',
        taxId: `${randInt(1000000, 1999999)}${'ABCDEFGHJK'[i]}/A/M/000`,
        notes: `Gérant : ${c.gerant}. ${c.activite}.`,
        nonFacturable: c.nonFacturable,
        soldeAnterieur: i % 3 === 0 ? pick([350, 600, 1200]) : 0,
        customFields,
      },
    });
    clients.push({ ...c, id: created.id });
  }
  console.log(`${clients.length} clients créés.`);

  // 4. 50 completed tasks over the month. Missions come from the catalogue
  //    the server seeds for this company on its first request.
  const services: any[] = await api('/api/services', { token });
  const taskTypes: any[] = await api('/api/task-types', { token });
  const missions = services
    .map(s => ({ s, types: taskTypes.filter(t => t.serviceId === s.id) }))
    .filter(x => x.types.length > 0);
  if (missions.length === 0) throw new Error('Aucune mission dans le catalogue — le semis du secteur n\'a pas eu lieu.');

  // The intern takes a two-day leave inside the month: nothing is scheduled
  // for her on those days (phase 2 skips her attendance on them too).
  const leaveDays = month.workdays.slice(Math.floor(month.workdays.length / 2), Math.floor(month.workdays.length / 2) + 2);

  const weighted = clients.flatMap(c => Array(c.weight).fill(c));
  type Planned = { who: typeof team[number]; client: typeof clients[number]; day: number; start: number; end: number; mission: typeof missions[number]; type: any };
  const planned: Planned[] = [];
  const nextFree = new Map<string, number>();
  const shares = [15, 14, 13, 8]; // supervisor, two collaborators, intern
  team.forEach((who, ti) => {
    for (let n = 0; n < shares[ti]; n++) {
      const days = month.workdays.filter(d => !(who.role === 'STAGIAIRE' && leaveDays.includes(d)));
      let day = pick(days);
      let start = nextFree.get(`${who.id}-${day}`) ?? (8 * 60 + pick([15, 30, 45]));
      // A day that is already full moves the task to another day.
      for (let tries = 0; start > 14 * 60 && tries < 20; tries++) {
        day = pick(days);
        start = nextFree.get(`${who.id}-${day}`) ?? (8 * 60 + pick([15, 30, 45]));
      }
      const end = Math.min(start + randInt(6, 20) * 15, 17 * 60 + 30); // 1h30 to 5h, never past 17:30
      nextFree.set(`${who.id}-${day}`, end + pick([15, 30, 60]));
      const mission = pick(missions);
      planned.push({ who, client: pick(weighted), day, start, end, mission, type: pick(mission.types) });
    }
  });
  // Created oldest first: the table lists the newest creation on top.
  planned.sort((a, b) => a.day - b.day || a.start - b.start);
  for (const [i, p] of planned.entries()) {
    const created = await api('/api/time-entries', {
      method: 'POST', token: p.who.token,
      body: {
        id: `demo-${p.who.id}-${i}`, client: p.client.name, clientId: p.client.id, description: '',
        pole: p.mission.s.name, serviceId: p.mission.s.id, taskType: p.type.name, taskTypeId: p.type.id,
        statut: 'RUNNING',
      },
    });
    await api(`/api/time-entries/${created.id}`, {
      method: 'PUT', token: p.who.token,
      body: { statut: 'COMPLETED', date: fr(month.y, month.m, p.day), heureDebut: hm(p.start), heureFin: hm(p.end) },
    });
  }
  console.log(`${planned.length} tâches terminées créées.`);

  // 5. Invoices: one per billable client, dated in order (the legal
  //    sequence refuses a date earlier than the previous invoice). The
  //    amounts are deliberately uneven so the profitability view has
  //    something to say: one client billed far below the time spent on it,
  //    one with time spent and nothing billed at all.
  const billable = clients.filter(c => !c.nonFacturable && c.name !== 'Olivia Agro SARL');
  const amounts: Record<string, number> = {
    'Atlas Négoce SARL': 1800, 'Carthage Digital SUARL': 950, 'Medina Bâtiment SA': 260,
    'Sahel Logistique SUARL': 700, 'Cabinet Dentaire Dr. Mansour': 450, 'Jasmin Événements SARL': 600,
    'Nour Pharma Distribution SA': 1400, 'Djerba Hôtellerie SA': 1100,
  };
  const invoiceDays = billable.map((_, i) => month.workdays[Math.min(month.workdays.length - 1, Math.floor((i + 1) * month.workdays.length / (billable.length + 1)))]);
  const invoices: { client: typeof clients[number]; net: number; day: number }[] = [];
  for (const [i, c] of billable.entries()) {
    const day = invoiceDays[i];
    const due = new Date(Date.UTC(month.y, month.m - 1, day + 15));
    const inv = await api('/api/invoices', {
      method: 'POST', token,
      body: {
        clientId: c.id, clientName: c.name, issueDate: iso(month.y, month.m, day),
        dueDate: due.toISOString().slice(0, 10),
        documentKind: 'FACTURE_LEGALE', billingMode: 'FORFAIT', vatRegime: 'DROIT_COMMUN', currency: 'TND',
        title: 'Facture',
        lines: [{ designation: `Honoraires — ${c.activite.toLowerCase()} — ${pad(month.m)}/${month.y}`, montantHT: amounts[c.name] ?? 500, vatRate: 0.19 }],
        withholdingRate: 0.01, showWithholding: true, stampDuty: 1, showStampDuty: true,
      },
    });
    invoices.push({ client: c, net: Number(inv.totalNetToPay) || 0, day });
  }
  // One draft, prepared for next month.
  await api('/api/invoices', {
    method: 'POST', token,
    body: {
      clientId: clients[0].id, clientName: clients[0].name, issueDate: iso(month.y, month.m, month.workdays[month.workdays.length - 1]),
      documentKind: 'FACTURE_LEGALE', billingMode: 'FORFAIT', vatRegime: 'DROIT_COMMUN', currency: 'TND', status: 'DRAFT',
      title: 'Facture', lines: [{ designation: 'Honoraires — mois suivant', montantHT: 1800, vatRate: 0.19 }],
      withholdingRate: 0.01, showWithholding: true, stampDuty: 1, showStampDuty: true,
    },
  });
  console.log(`${invoices.length} factures émises + 1 brouillon.`);

  // 6. Payments and cash movements: some invoices paid in full, some in
  //    part, some not at all — so « reste à encaisser » and the overdue
  //    receivables alert both show something.
  const modes = ['VIREMENT', 'CHEQUE', 'ESPECE'];
  for (const [i, inv] of invoices.entries()) {
    const share = [1, 1, 0.5, 0, 1, 0.4, 0, 1][i % 8];
    if (share === 0) continue;
    const day = Math.min(month.upTo, inv.day + randInt(2, 8));
    const mode = modes[i % modes.length];
    await api('/api/cash-journal', {
      method: 'POST', token,
      body: {
        date: iso(month.y, month.m, day), clientId: inv.client.id, clientName: inv.client.name,
        category: 'Règlement client', label: share < 1 ? 'Acompte sur facture' : 'Règlement facture',
        entree: Math.round(inv.net * share * 1000) / 1000, paymentMethod: mode,
        bankAccount: mode === 'ESPECE' ? '' : 'BIAT — TN59 0800 1000 0000 1234 5678',
        reference: mode === 'CHEQUE' ? `CHQ ${randInt(1000000, 9999999)}` : mode === 'VIREMENT' ? `VIR-${randInt(10000, 99999)}` : '',
      },
    });
  }
  for (const [label, category, sortie, day] of [
    ['Alimentation de caisse', 'Alimentation caisse', 0, 1],
    ['Loyer du bureau', 'Loyer', 1200, 3],
    ['Facture STEG', 'STEG', 186.4, 8],
    ['Abonnement internet', 'Télécommunications', 89, 10],
    ['Fournitures de bureau', 'Fournitures', 74.5, 14],
    ['Femme de ménage', 'Femme de ménage', 250, 20],
  ] as [string, string, number, number][]) {
    if (day > month.upTo) continue;
    await api('/api/cash-journal', {
      method: 'POST', token,
      body: { date: iso(month.y, month.m, day), category, label, sortie, entree: label.startsWith('Alimentation') ? 1500 : 0, paymentMethod: 'ESPECE' },
    });
  }
  console.log('Règlements clients et brouillard de caisse renseignés.');

  // 7. HR: the intern's two-day leave (approved), an absence, an advance.
  const [sup, , mehdi, ines] = team;
  if (leaveDays.length === 2) {
    const leave = await api('/api/hr/leaves', {
      method: 'POST', token: ines.token,
      body: {
        type: 'Congé annuel', startDate: iso(month.y, month.m, leaveDays[0]), endDate: iso(month.y, month.m, leaveDays[1]),
        duration: leaveDays[1] - leaveDays[0] + 1, reason: 'Congés personnels', approverId: sup.id,
      },
    });
    await api(`/api/hr/leaves/${leave.id}/approve`, { method: 'POST', token, body: {} });
  }
  const absenceDay = month.workdays[Math.min(3, month.workdays.length - 1)];
  const absence = await api('/api/hr/authorizations', {
    method: 'POST', token: mehdi.token,
    body: { date: iso(month.y, month.m, absenceDay), startTime: '15:00', endTime: '17:00', duration: 2, reason: 'Rendez-vous médical', comment: '', approverId: sup.id },
  });
  await api(`/api/hr/authorizations/${absence.id}/approve`, { method: 'POST', token, body: {} });
  const advance = await api('/api/hr/advances', {
    method: 'POST', token: mehdi.token, body: { amount: 200, reason: 'Avance sur salaire', approverId: sup.id },
  });
  await api(`/api/hr/advances/${advance.id}/approve`, { method: 'POST', token, body: {} });
  console.log('RH : un congé, une autorisation d\'absence et une avance, approuvés.');

  // 8. One payslip each for the month — computed by computePayslip() on the server.
  for (const t of team) {
    const conges = t.role === 'STAGIAIRE' ? leaveDays.length : 0;
    await api('/api/payslips', {
      method: 'POST', token,
      body: {
        userId: t.id, year: month.y, month: month.m,
        joursFeries: month.holidaysInMonth, primePresence: t.role === 'STAGIAIRE' ? 0 : 40,
        primeTransport: 35, primeEncouragement: t.role === 'SUPERVISEUR' ? 100 : 0,
        nbHeures: 173.2, nHeures: 0, joursConges: conges, joursAbsences: 0,
        soldeConge: t.soldeConge - conges,
      },
    });
  }
  console.log(`${team.length} bulletins de paie générés pour ${pad(month.m)}/${month.y}.`);

  // 9. Échéances: every column up to this month filled for every client,
  //    with the odd default and a few still being prepared.
  const options: any[] = await api('/api/echeance-status-options', { token });
  const label = (color: string, fallback: string) => options.find(o => o.color === color)?.label ?? fallback;
  const OUI = label('done', 'Oui'), DEFAUT = label('late', 'DEFAUT'), PREP = label('run', 'Préparée (en attente de confirmation client)');
  const NA = options.find(o => o.color === 'gray')?.label ?? 'Client non concerné par l\'échéance';
  const echeanceColumns: any[] = await api(`/api/echeance-columns?year=${month.y}`, { token });
  let cells = 0;
  for (const col of echeanceColumns.filter(c => c.month <= month.m)) {
    for (const [ci, c] of clients.entries()) {
      const r = rand();
      const current = col.month === month.m;
      let status: string | null;
      if (/CNSS/i.test(col.label) && c.forme === 'Personne physique') status = NA;
      else if (current) status = r < 0.4 ? OUI : r < 0.7 ? PREP : r < 0.8 ? DEFAUT : null;
      else status = r < 0.88 ? OUI : r < 0.95 ? DEFAUT : NA;
      if (!status) continue;
      const paid = status === OUI;
      await api('/api/echeance-statuses', {
        method: 'PUT', token,
        body: {
          clientId: c.id, columnId: col.id, status,
          ...(paid ? { quittanceNumber: `${month.y}-${pad(col.month)}${pad(ci)}${randInt(10, 99)}`, montant: pick([45, 86.5, 120, 210, 340.75, 512]) } : {}),
        },
      });
      cells++;
    }
  }
  console.log(`Échéances : ${cells} cellules renseignées sur ${echeanceColumns.filter(c => c.month <= month.m).length} colonnes.`);

  // 10. Procedures in progress, assigned across the team, partly ticked.
  const templates: any[] = await api('/api/resource-templates', { token });
  let procedures = 0;
  for (const [i, c] of clients.slice(0, 7).entries()) {
    const template = templates[i % templates.length];
    if (!template) break;
    const owner = team[i % team.length];
    await api('/api/client-resources', { method: 'POST', token, body: { clientId: c.id, templateId: template.id, assignedTo: owner.id } });
    const instances: any[] = await api(`/api/client-resources?clientId=${c.id}`, { token });
    const inst = instances.find(x => x.templateId === template.id) ?? instances[instances.length - 1];
    const items: any[] = inst?.items ?? [];
    const toTick = Math.floor(items.length * [0.8, 0.5, 0.3, 1, 0.6, 0.2, 0.4][i]);
    for (const item of items.slice(0, toTick)) {
      await api(`/api/client-resource-items/${item.id}`, { method: 'PUT', token, body: { done: true } });
    }
    procedures++;
  }
  console.log(`${procedures} procédures en cours affectées.`);

  // 11. One portal account per client.
  const portal: string[] = [];
  for (const c of clients) {
    const username = `demo.${fold(c.name).replace(/[^a-z]/g, '').slice(0, 16)}`;
    await api('/api/users', { method: 'POST', token, body: { username, password: PORTAL_PASSWORD, role: 'CLIENT', clientId: c.id, permissions: [] } });
    portal.push(username);
  }
  console.log(`${portal.length} comptes portail client créés.\n`);

  return { portal, leaveDays };
}

// ---------------------------------------------------------------------------
// Phase 2 — straight to the database
// ---------------------------------------------------------------------------

async function phaseDirect() {
  const month = targetMonth();
  const db = await initDb();

  const demo = await db.getUserByUsername(DEMO_USERNAME);
  if (!demo) throw new Error(`Aucun utilisateur « ${DEMO_USERNAME} » — lancez d'abord la phase 1.`);
  const companyId = demo.companyId;

  // The password the API cannot set: shorter than its six-character minimum.
  await db.updateUser(companyId, demo.id, { password: await bcrypt.hash(DEMO_PASSWORD, 10) });

  const leaves = (await db.getAllLeaveRequests(companyId)).filter((l: any) => l.status === 'APPROVED');
  const onLeave = (userId: number, date: string) => leaves.some((l: any) => l.userId === userId && l.startDate <= date && date <= l.endDate);
  const existing = await db.getAllAttendanceRecords(companyId);

  let created = 0;
  for (const t of TEAM) {
    const user = await db.getUserByUsername(t.username);
    if (!user) continue;
    for (const d of month.workdays) {
      const date = iso(month.y, month.m, d);
      if (onLeave(user.id, date)) continue;
      if (existing.some((r: any) => r.userId === user.id && r.date === date)) continue;
      // Arrivals between 07:50 and 08:25 — a few late past the tolerance —
      // and departures between 16:55 and 17:45. Tunis is UTC+1 all year.
      const inMin = 8 * 60 + (rand() < 0.15 ? randInt(10, 25) : randInt(-10, 6));
      const outMin = 17 * 60 + randInt(-5, 45);
      const at = (minutes: number) => `${date}T${hm(minutes)}:${pad(randInt(0, 59))}+01:00`;
      await db.createAttendanceRecord(companyId, {
        id: Date.now() * 100 + created,
        userId: user.id,
        date,
        checkinAt: new Date(at(inMin)).toISOString(),
        checkinViaPhone: rand() < 0.1,
        checkinLateMinutes: inMin - 8 * 60,
        checkoutAt: new Date(at(outMin)).toISOString(),
        checkoutViaPhone: false,
        checkoutLateMinutes: outMin - 17 * 60,
        shiftStart: SHIFT.shiftStart,
        shiftEnd: SHIFT.shiftEnd,
        breakMinutes: SHIFT.breakMinutes,
      });
      created++;
    }
  }
  console.log(`Phase 2 — mot de passe « ${DEMO_PASSWORD} » posé, ${created} pointages de présence créés.`);
  // The JSON engine coalesces writes on a timer; give it time to flush.
  await new Promise(r => setTimeout(r, 1500));
}

// ---------------------------------------------------------------------------

async function main() {
  const finishOnly = process.argv.includes('--finish');
  let portal: string[] = [];
  if (!finishOnly) {
    ({ portal } = await phaseApi());
    if (!process.env.DATABASE_URL) {
      console.log('Base JSON locale : arrêtez le serveur (npm run dev), puis lancez');
      console.log('  npm run db:seed-demo-account -- --finish');
      console.log('pour le pointage de présence et le mot de passe « demo ».');
      return;
    }
  }
  await phaseDirect();

  console.log('\n' + '='.repeat(64));
  console.log(`  Administrateur : ${DEMO_USERNAME} / ${DEMO_PASSWORD}`);
  console.log(`  Équipe         : ${TEAM.map(t => t.username).join(', ')} / ${TEAM_PASSWORD}`);
  console.log(`  Portail client : demo.<client> / ${PORTAL_PASSWORD}${portal.length ? ` (${portal.join(', ')})` : ''}`);
  console.log('='.repeat(64));
}

main().catch((e) => {
  console.error('\nÉchec :', e.message || e);
  process.exit(1);
});
