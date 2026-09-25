/**
 * Seed a realistic demo dataset into a *running* instance of the app, driven
 * entirely through its own HTTP API — never by writing rows to the database
 * directly. Every number this script produces (employer cost, task duration,
 * invoice cascade, payslip IRPP/CSS/CNSS, leave balances) is therefore
 * computed by the exact same server code a real user's clicks would trigger:
 * `employerHourlyRate()`, `computeInvoiceTotals()`, `computePayslip()` and the
 * leave-balance/loan/advance routes. A script that poked the database with
 * its own copies of those formulas could silently drift from the real rules
 * (exactly the class of bug this codebase's own `computeInvoiceTotals()` /
 * `computePayslip()` "one cascade, not N copies" convention exists to avoid)
 * — going through the API is what guarantees the seeded numbers are real.
 *
 * Usage:
 *
 *   npm run dev                    # in one terminal — the app must be running
 *   npm run db:seed-demo           # in another — talks to http://localhost:3000
 *
 * Point it at a different running instance with SEED_BASE_URL:
 *
 *   SEED_BASE_URL="https://staging.example.com" npm run db:seed-demo
 *
 * Idempotency: usernames are fixed (`ahmed.bensalah`, …) so a second run
 * fails fast on "Username already exists" for the collaborators/clients it
 * already created rather than silently duplicating them. Delete
 * `local.db.json` (dev) or the company's rows (Postgres) to start over.
 */

const BASE_URL = process.env.SEED_BASE_URL || 'http://localhost:3000';

type Json = Record<string, any>;

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

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pad(n: number): string {
  return String(n).padStart(2, '0');
}
/** DD/MM/YYYY — the exact display format time entries store their `date` as. */
function fmtDateFR(d: Date): string {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function fmtDateISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtTime(hour: number, minute: number): string {
  return `${pad(hour)}:${pad(minute)}`;
}
/** A weekday N days before today (skips Sat/Sun, since a cabinet's activity does). */
function weekdayDaysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d;
}

async function main() {
  console.log(`Seeding demo data into ${BASE_URL} ...\n`);
  try {
    await api('/api/login', { method: 'POST', body: { username: '__ping__', password: '__ping__' } });
  } catch (e: any) {
    if (/fetch failed|ECONNREFUSED/.test(String(e))) {
      console.error(`Cannot reach ${BASE_URL}. Start the app first: npm run dev`);
      process.exit(1);
    }
    // A 401/400 "invalid credentials" means the server answered — that's fine, keep going.
  }

  // ---------------------------------------------------------------------
  // 1. Admin login (the seeded default account, per CLAUDE.md)
  // ---------------------------------------------------------------------
  const adminToken = await login('admin', 'admin123');
  const admin = await api('/api/me', { token: adminToken });
  console.log(`Logged in as admin (id ${admin.id}).`);

  // ---------------------------------------------------------------------
  // 2. Collaborators — full "Gestion des paies" dossier + coût employeur,
  //    respecting the CNSS/TFP/FOPROLOS/accident du travail rates a real
  //    Tunisian cabinet pays (defaultSettings(), CLAUDE.md "Employer cost").
  // ---------------------------------------------------------------------
  const CHARGES = { cnss: 17.07, tfp: 2.0, foprolos: 1.0, accidentTravail: 0.5 };
  const COLLAB_PERMS = ['VIEW', 'EDIT', 'MODIFY', 'CREATE_LEAVE_REQUEST', 'CREATE_ABSENCE_AUTHORIZATION', 'CREATE_LOAN_REQUEST', 'VIEW_HR'];
  const SUPERVISOR_PERMS = [...COLLAB_PERMS, 'MANAGE_LEAVE_REQUESTS', 'MANAGE_ABSENCE_AUTHORIZATIONS', 'MANAGE_LOANS_ADVANCES', 'ASSIGN_TASKS', 'VIEW_CLIENTS'];

  type CollabSeed = {
    username: string; password: string; role: string; permissions: string[];
    salaireBrut: number; regimeHoraire: number; primesFraisNonCotisables: number;
    soldeConge: number; matricule: string; numCin: string; numCnss: string;
    qualification: string; departement: string; banque: string; numeroCompte: string;
    situationFamiliale: string; nombreEnfants: number; categorie: string; echelon: string;
    salHeure: number;
  };

  const collaboratorSeeds: CollabSeed[] = [
    {
      username: 'ahmed.bensalah', password: 'Demo1234!', role: 'COLLABORATOR', permissions: COLLAB_PERMS,
      salaireBrut: 1200, regimeHoraire: 40, primesFraisNonCotisables: 50, soldeConge: 21,
      matricule: 'EMP-001', numCin: '08123456', numCnss: '3312456789',
      qualification: 'Comptable', departement: 'Comptabilité', banque: 'BIAT', numeroCompte: 'TN59 1000 6035 0000 1234 5601',
      situationFamiliale: 'Célibataire', nombreEnfants: 0, categorie: 'Cadre', echelon: '2',
      salHeure: 6.99,
    },
    {
      username: 'sonia.trabelsi', password: 'Demo1234!', role: 'SUPERVISEUR', permissions: SUPERVISOR_PERMS,
      salaireBrut: 1900, regimeHoraire: 40, primesFraisNonCotisables: 90, soldeConge: 24,
      matricule: 'EMP-002', numCin: '07998877', numCnss: '3308811223',
      qualification: 'Chef de mission', departement: 'Audit', banque: 'ATB', numeroCompte: 'TN59 0400 6035 0000 5678 9012',
      situationFamiliale: 'Marié(e)', nombreEnfants: 2, categorie: 'Cadre supérieur', echelon: '4',
      salHeure: 11.05,
    },
    {
      username: 'karim.jlassi', password: 'Demo1234!', role: 'COLLABORATOR', permissions: COLLAB_PERMS,
      salaireBrut: 1100, regimeHoraire: 40, primesFraisNonCotisables: 40, soldeConge: 21,
      matricule: 'EMP-003', numCin: '09554433', numCnss: '3315566778',
      qualification: 'Assistant comptable', departement: 'Fiscalité', banque: 'UIB', numeroCompte: 'TN59 1010 6035 0000 3456 7890',
      situationFamiliale: 'Marié(e)', nombreEnfants: 1, categorie: 'Agent de maîtrise', echelon: '1',
      salHeure: 6.41,
    },
    {
      username: 'nour.gharbi', password: 'Demo1234!', role: 'STAGIAIRE', permissions: COLLAB_PERMS,
      salaireBrut: 500, regimeHoraire: 40, primesFraisNonCotisables: 0, soldeConge: 12,
      matricule: 'EMP-004', numCin: '11223344', numCnss: '3320099887',
      qualification: 'Stagiaire comptable', departement: 'Comptabilité', banque: 'BH Bank', numeroCompte: 'TN59 0800 6035 0000 2222 3333',
      situationFamiliale: 'Célibataire', nombreEnfants: 0, categorie: 'Stagiaire', echelon: '-',
      salHeure: 2.91,
    },
  ];

  type Collab = CollabSeed & { id: number; token: string };
  const collaborators: Collab[] = [];

  for (const seed of collaboratorSeeds) {
    const body = {
      username: seed.username, password: seed.password, role: seed.role, permissions: seed.permissions,
      salaireBrut: seed.salaireBrut, regimeHoraire: seed.regimeHoraire,
      cnss: CHARGES.cnss, tfp: CHARGES.tfp, foprolos: CHARGES.foprolos, accidentTravail: CHARGES.accidentTravail,
      primesFraisNonCotisables: seed.primesFraisNonCotisables, soldeConge: seed.soldeConge,
      matricule: seed.matricule, numCin: seed.numCin, numCnss: seed.numCnss,
      qualification: seed.qualification, departement: seed.departement, banque: seed.banque, numeroCompte: seed.numeroCompte,
      situationFamiliale: seed.situationFamiliale, nombreEnfants: seed.nombreEnfants,
      categorie: seed.categorie, echelon: seed.echelon, salHeure: seed.salHeure,
    };
    const created = await api('/api/users', { method: 'POST', token: adminToken, body });
    const token = await login(seed.username, seed.password);
    collaborators.push({ ...seed, id: created.id, token });
    console.log(`Created collaborator ${seed.username} (${seed.role}, id ${created.id}, salaire ${seed.salaireBrut} DT).`);
  }

  // Also fill in the seeded default `collab` account so the documented
  // default login shows full data too, not just the newly named accounts.
  // PUT /api/users/:id replaces role/permissions wholesale rather than
  // merging (same "the client always resends the whole form" shape as
  // PUT /api/time-entries/:id) — omitting them here would silently wipe
  // this account's existing role and permissions, not just leave them
  // untouched, so both are re-sent explicitly below.
  const collabToken = await login('collab', 'collab123');
  const collabMe = await api('/api/me', { token: collabToken });
  await api(`/api/users/${collabMe.id}`, {
    method: 'PUT', token: adminToken,
    body: {
      role: collabMe.role, permissions: COLLAB_PERMS,
      salaireBrut: 1000, regimeHoraire: 40,
      cnss: CHARGES.cnss, tfp: CHARGES.tfp, foprolos: CHARGES.foprolos, accidentTravail: CHARGES.accidentTravail,
      primesFraisNonCotisables: 30, soldeConge: 21,
      matricule: 'EMP-000', numCin: '06112233', numCnss: '3301122334',
      qualification: 'Collaborateur comptable', departement: 'Comptabilité', banque: 'STB', numeroCompte: 'TN59 0500 6035 0000 9988 7766',
      situationFamiliale: 'Célibataire', nombreEnfants: 0, categorie: 'Employé', echelon: '1', salHeure: 5.82,
    },
  });
  const collabSeed: Collab = {
    username: 'collab', password: 'collab123', role: collabMe.role, permissions: COLLAB_PERMS,
    salaireBrut: 1000, regimeHoraire: 40, primesFraisNonCotisables: 30, soldeConge: 21,
    matricule: 'EMP-000', numCin: '06112233', numCnss: '3301122334',
    qualification: 'Collaborateur comptable', departement: 'Comptabilité', banque: 'STB', numeroCompte: 'TN59 0500 6035 0000 9988 7766',
    situationFamiliale: 'Célibataire', nombreEnfants: 0, categorie: 'Employé', echelon: '1', salHeure: 5.82,
    id: collabMe.id, token: collabToken,
  };
  collaborators.push(collabSeed);
  console.log(`Filled in the default "collab" account (id ${collabMe.id}) with salary/payroll data too.\n`);

  // ---------------------------------------------------------------------
  // 3. Clients
  // ---------------------------------------------------------------------
  const clientSeeds = [
    { name: 'STE ALPHA CONSTRUCTION', taxId: '1234567A/A/M/000', city: 'Tunis', secteur: 'BTP', nonFacturable: false },
    { name: 'Cabinet Médical Ben Youssef', taxId: '0998877B/P/M/000', city: 'Sfax', secteur: 'Santé', nonFacturable: false },
    { name: 'SARL TECHNOVA', taxId: '1122334C/A/M/001', city: 'Ariana', secteur: 'Informatique', nonFacturable: false },
    { name: 'Association Culturelle El Fen', taxId: '0011223D/N/M/000', city: 'Tunis', secteur: 'Associatif', nonFacturable: true },
    { name: 'Garage Masmoudi', taxId: '3344556E/A/M/000', city: 'Sousse', secteur: 'Automobile', nonFacturable: false },
    { name: 'Pharmacie Centrale', taxId: '5566778F/A/M/000', city: 'Nabeul', secteur: 'Pharmacie', nonFacturable: false },
  ];
  type ClientRow = { id: number; name: string; nonFacturable: boolean };
  const clients: ClientRow[] = [];
  for (const c of clientSeeds) {
    const created = await api('/api/clients', {
      method: 'POST', token: adminToken,
      body: {
        name: c.name, taxId: c.taxId, city: c.city, country: 'Tunisie',
        nonFacturable: c.nonFacturable,
        customFields: { 'Secteur d\'activité': c.secteur },
      },
    });
    clients.push({ id: created.id, name: created.name, nonFacturable: c.nonFacturable });
    console.log(`Created client ${c.name} (id ${created.id}${c.nonFacturable ? ', non facturable' : ''}).`);
  }
  console.log('');

  // ---------------------------------------------------------------------
  // 4. Missions / types de tâche — reuse the auto-seeded sector catalogue
  //    (see CLAUDE.md "Le catalogue livré d'office") rather than inventing
  //    a second one; just pick a spread of real (mission, type) pairs.
  // ---------------------------------------------------------------------
  const services: { id: number; name: string }[] = await api('/api/services', { token: adminToken });
  const taskTypes: { id: number; name: string; serviceId: number }[] = await api('/api/task-types', { token: adminToken });
  const missionPool = services
    .map(s => ({ service: s, types: taskTypes.filter(t => t.serviceId === s.id) }))
    .filter(m => m.types.length > 0);
  if (missionPool.length === 0) throw new Error('No missions/task types found — the sector catalogue did not seed.');
  console.log(`Found ${services.length} missions / ${taskTypes.length} task types from the auto-seeded catalogue.\n`);

  // ---------------------------------------------------------------------
  // 5. Historical, COMPLETED time entries — the activity history / dashboard
  //    data. Each is created RUNNING (server-stamped, today) then backdated
  //    via PUT (date/heureDebut/heureFin), which is what the app's own edit
  //    path (EditTaskModal) does — see CLAUDE.md "Live timers".
  // ---------------------------------------------------------------------
  console.log('Creating historical time entries ...');
  let entryCount = 0;
  for (const collab of collaborators) {
    const entriesForThisCollab = collab.role === 'STAGIAIRE' ? 10 : 16;
    for (let i = 0; i < entriesForThisCollab; i++) {
      const daysAgo = randInt(1, 65);
      const date = weekdayDaysAgo(daysAgo);
      const client = pick(clients);
      const mission = pick(missionPool);
      const type = pick(mission.types);
      const startHour = randInt(8, 15);
      const startMin = pick([0, 15, 30, 45]);
      const durationMinutes = randInt(45, 240);
      const endTotal = startHour * 60 + startMin + durationMinutes;
      const endHour = Math.min(19, Math.floor(endTotal / 60));
      const endMin = endTotal % 60;

      const created = await api('/api/time-entries', {
        method: 'POST', token: collab.token,
        body: {
          id: `seed-${collab.id}-${Date.now()}-${i}`,
          client: client.name, clientId: client.id,
          description: '', pole: mission.service.name, serviceId: mission.service.id,
          taskType: type.name, taskTypeId: type.id,
          statut: 'RUNNING',
        },
      });
      await api(`/api/time-entries/${created.id}`, {
        method: 'PUT', token: collab.token,
        body: {
          statut: 'COMPLETED',
          date: fmtDateFR(date),
          heureDebut: fmtTime(startHour, startMin),
          heureFin: fmtTime(endHour, endMin),
        },
      });
      entryCount++;
    }
    console.log(`  ${collab.username}: ${entriesForThisCollab} completed tasks.`);
  }
  console.log(`Created ${entryCount} historical time entries in total.\n`);

  // ---------------------------------------------------------------------
  // 6. A handful of legal invoices, so the dashboard's "Rentabilité"/
  //    "Grand-livre client" and Cash both have real honoraires to show.
  // ---------------------------------------------------------------------
  console.log('Creating invoices ...');
  const facturableClients = clients.filter(c => !c.nonFacturable);
  let invoiceCount = 0;
  // A legal invoice can never precede the previous one in the sequence
  // (legalSequenceDateError — see CLAUDE.md "Cash"), and a new invoice is
  // always last, so the dates must be generated in non-decreasing order
  // *before* creating anything, rather than picked independently per call.
  const invoiceDaysAgo = Array.from({ length: 6 }, () => randInt(1, 50)).sort((a, b) => b - a);
  for (const daysAgo of invoiceDaysAgo) {
    const client = pick(facturableClients);
    const date = weekdayDaysAgo(daysAgo);
    const amount = randInt(400, 3200);
    await api('/api/invoices', {
      method: 'POST', token: adminToken,
      body: {
        clientId: client.id, clientName: client.name,
        issueDate: fmtDateISO(date), documentKind: 'FACTURE_LEGALE',
        billingMode: 'FORFAIT', vatRegime: 'DROIT_COMMUN', currency: 'TND',
        // computeInvoiceTotals() always reads montantHT directly off each
        // line — regardless of billing mode, Qté×PU is only ever a client-
        // side convenience under "Détaillée" (CLAUDE.md "Cash"). Both
        // vatRate and withholdingRate are fractions on the wire (0.19 for
        // 19%, 0.01 for 1%) — the editor converts the percentage an admin
        // types before sending it; the raw API does not.
        lines: [{ designation: 'Honoraires de mission — prestations comptables et fiscales', montantHT: amount, vatRate: 0.19 }],
        withholdingRate: 0.01, showWithholding: true, stampDuty: 1, showStampDuty: true,
      },
    });
    invoiceCount++;
  }
  console.log(`Created ${invoiceCount} legal invoices.\n`);

  // ---------------------------------------------------------------------
  // 7. RH module data — congés, autorisations d'absence, prêts, avances.
  //    Requests are self-service (the route always uses the caller's own
  //    id), so each is created with the relevant collaborator's own token,
  //    then approved as admin (ADMIN bypasses the approverId check).
  // ---------------------------------------------------------------------
  console.log('Creating RH requests (congés, absences, prêts, avances) ...');
  const realCollabs = collaborators.filter(c => c.role !== 'STAGIAIRE' || true); // everyone can request

  // Congés — a couple already taken (approved, past dates) + one pending (future).
  for (const [collab, startDaysAgo, duration, status] of [
    [realCollabs[0], 30, 3, 'approve'],
    [realCollabs[1], 20, 5, 'approve'],
    [realCollabs[2], -10, 2, 'pending'], // negative = in the future
  ] as [Collab, number, number, 'approve' | 'pending'][]) {
    const start = weekdayDaysAgo(startDaysAgo);
    const end = new Date(start);
    end.setDate(end.getDate() + duration - 1);
    const leave = await api('/api/hr/leaves', {
      method: 'POST', token: collab.token,
      body: {
        type: 'Congé annuel', startDate: fmtDateISO(start), endDate: fmtDateISO(end),
        duration, reason: 'Congés annuels', approverId: admin.id,
      },
    });
    if (status === 'approve') {
      await api(`/api/hr/leaves/${leave.id}/approve`, { method: 'POST', token: adminToken, body: {} });
    }
  }

  // Autorisations d'absence — one approved, one pending.
  for (const [collab, daysAgo, status] of [
    [realCollabs[0], 15, 'approve'],
    [realCollabs[3], -3, 'pending'],
  ] as [Collab, number, 'approve' | 'pending'][]) {
    const date = weekdayDaysAgo(daysAgo);
    const auth = await api('/api/hr/authorizations', {
      method: 'POST', token: collab.token,
      body: {
        date: fmtDateISO(date), startTime: '09:00', endTime: '11:00', duration: 2,
        reason: 'Rendez-vous personnel', comment: '', approverId: admin.id,
      },
    });
    if (status === 'approve') {
      await api(`/api/hr/authorizations/${auth.id}/approve`, { method: 'POST', token: adminToken, body: {} });
    }
  }

  // Prêts — one active (approved).
  {
    const loan = await api('/api/hr/loans', {
      method: 'POST', token: realCollabs[0].token,
      body: { amount: 1500, monthlyDeduction: 150, reason: 'Prêt personnel', approverId: admin.id },
    });
    await api(`/api/hr/loans/${loan.id}/approve`, { method: 'POST', token: adminToken, body: {} });
  }

  // Avances — one active (approved).
  {
    const advance = await api('/api/hr/advances', {
      method: 'POST', token: realCollabs[2].token,
      body: { amount: 300, reason: 'Avance sur salaire', approverId: admin.id },
    });
    await api(`/api/hr/advances/${advance.id}/approve`, { method: 'POST', token: adminToken, body: {} });
  }
  console.log('Created congés (approved + pending), autorisations, un prêt actif et une avance active.\n');

  // ---------------------------------------------------------------------
  // 8. Payslips — two consecutive months per collaborator, generated in
  //    order so the second exercises the real cumulative-regularization
  //    path in computePayslip() (see CLAUDE.md "Gestion des paies").
  // ---------------------------------------------------------------------
  console.log('Generating payslips ...');
  const now = new Date();
  const months: { year: number; month: number }[] = [];
  for (let back = 2; back >= 1; back--) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  let payslipCount = 0;
  for (const collab of collaborators) {
    for (const { year, month } of months) {
      await api('/api/payslips', {
        method: 'POST', token: adminToken,
        body: {
          userId: collab.id, year, month,
          joursFeries: 0, primePresence: 40, primeTransport: 30, primeEncouragement: 20,
          nbHeures: collab.regimeHoraire * 4.33, nHeures: 0, joursConges: 0, joursAbsences: 0,
        },
      });
      payslipCount++;
    }
  }
  console.log(`Generated ${payslipCount} payslips (2 mois × ${collaborators.length} collaborateurs).\n`);

  // ---------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------
  console.log('='.repeat(72));
  console.log('Demo data seeded. Logins:');
  console.log('='.repeat(72));
  console.log('  admin / admin123          (ADMIN — sees everything, including costs)');
  console.log('  collab / collab123        (COLLABORATOR — salary + history now filled)');
  for (const c of collaboratorSeeds) {
    console.log(`  ${c.username} / ${c.password}   (${c.role})`);
  }
  console.log('='.repeat(72));
}

main().catch((e) => {
  console.error('\nSeed failed:', e.message || e);
  process.exit(1);
});
