/**
 * Rattrape les dates et heures civiles écrites avant la correction de fuseau.
 *
 *   # Postgres (production)
 *   DATABASE_URL="postgresql://..." npm run db:fix-timezone -- --before "2026-09-01T08:00:00Z"
 *   DATABASE_URL="postgresql://..." npm run db:fix-timezone -- --before "..." --apply
 *
 *   # Base JSON locale
 *   npm run db:fix-timezone -- --before "..." --apply
 *
 * **Sans `--apply`, rien n'est écrit** : le script liste ce qu'il changerait et
 * s'arrête. C'est le mode par défaut, volontairement — on lit le rapport avant
 * de toucher aux données d'un cabinet.
 *
 * ## Ce qu'il corrige, et comment
 *
 * Le serveur estampillait `date`, `heureDebut` et `heureFin` avec l'heure
 * locale *du processus* — UTC en production — au lieu de celle du cabinet. Une
 * tâche démarrée à 08h42 à Tunis a donc été enregistrée « 07:42 ».
 *
 * Deux familles d'enregistrements, deux traitements, parce qu'ils n'offrent
 * pas la même matière :
 *
 * - **Pointage de présence** : la ligne porte `checkinAt` / `checkoutAt`, de
 *   vrais instants ISO, donc toujours justes. Le jour et les minutes de retard
 *   sont **recalculés** depuis eux. C'est idempotent par construction — rejouer
 *   le script redonne le même résultat — et ça n'a besoin d'aucune date de
 *   coupure.
 *
 * - **Entrées de temps** : elles ne portent *aucun* instant de création
 *   (`lastStartedAt` est réécrit à chaque reprise). Impossible de recalculer :
 *   il faut **décaler**. Un décalage n'étant pas idempotent, deux garde-fous :
 *   une date de coupure obligatoire (`--before`, le moment où le correctif est
 *   parti en service), et une marque `tzFixedAt` posée sur chaque ligne
 *   corrigée — une ligne déjà marquée n'est jamais retouchée, même si le
 *   script est relancé deux fois de suite.
 *
 * Le décalage n'est pas « +1 h » en dur : il est calculé pour la date de
 * chaque ligne, en comparant l'heure murale du cabinet à UTC au même instant.
 * La Tunisie n'a pas d'heure d'été aujourd'hui, mais coder le +1 en dur serait
 * faux le jour où elle en adopterait une, ou pour un cabinet ailleurs.
 *
 * ## Ce qu'il ne touche pas, délibérément
 *
 * - Les **instants** (`createdAt`, `checkinAt`, `lastStartedAt`…) : ils sont en
 *   ISO/UTC et ont toujours été justes. Les décaler casserait les durées.
 * - `dateGranted` d'un prêt ou d'une avance : la valeur par défaut était fausse
 *   uniquement entre minuit et 01h00, mais elle peut aussi avoir été **saisie à
 *   la main**, et rien ne distingue les deux. Écraser la date qu'un humain a
 *   tapée pour rattraper une poignée de cas est le mauvais échange.
 */
import { initDb } from '../src/server/database.js';
import type { Database } from '../src/server/db-types.js';

const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Africa/Tunis';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const beforeArg = (() => {
  const i = args.indexOf('--before');
  return i !== -1 ? args[i + 1] : undefined;
})();

if (!beforeArg) {
  console.error(`Il manque --before.

  --before <instant ISO>   Ne corriger que ce qui a été écrit AVANT cet instant,
                           c'est-à-dire le moment où le correctif de fuseau est
                           parti en service. Sans lui, le script décalerait
                           aussi les tâches déjà justes.

Exemple :
  npm run db:fix-timezone -- --before "2026-09-01T08:00:00Z"          (simulation)
  npm run db:fix-timezone -- --before "2026-09-01T08:00:00Z" --apply  (écriture)`);
  process.exit(1);
}
const beforeTs = new Date(beforeArg).getTime();
if (!Number.isFinite(beforeTs)) {
  console.error(`--before « ${beforeArg} » n'est pas un instant lisible (attendu : 2026-09-01T08:00:00Z).`);
  process.exit(1);
}

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIMEZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});
const civilParts = (d: Date) => {
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value;
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute };
};
const isoDay = (d: Date) => {
  const c = civilParts(d);
  return `${c.year}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`;
};
const minutesFromShift = (hhmm: string, at: Date) => {
  const [h, m] = hhmm.split(':').map(Number);
  const c = civilParts(at);
  return (c.hour * 60 + c.minute) - (h * 60 + m);
};

/** Décalage du fuseau du cabinet par rapport à UTC, en minutes, à cette date-là. */
const offsetMinutesAt = (utcMidnight: Date) => {
  const c = civilParts(utcMidnight);
  const asIfUtc = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute);
  return Math.round((asIfUtc - utcMidnight.getTime()) / 60000);
};

/** "DD/MM/YYYY" + "HH:mm" décalés de `minutes`. Rend la date *et* l'heure : un décalage peut changer de jour. */
const shift = (dateFr: string, timeHm: string, minutes: number) => {
  const [dd, mm, yyyy] = dateFr.split('/').map(Number);
  const [h, m] = timeHm.split(':').map(Number);
  const at = new Date(Date.UTC(yyyy, mm - 1, dd, h, m) + minutes * 60000);
  return {
    date: `${String(at.getUTCDate()).padStart(2, '0')}/${String(at.getUTCMonth() + 1).padStart(2, '0')}/${at.getUTCFullYear()}`,
    time: `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}`,
  };
};

const isDateFr = (v: any) => typeof v === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(v);
const isHm = (v: any) => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);

// Le même aiguillage que le serveur : Postgres si DATABASE_URL est posé, le
// fichier JSON sinon. Pas de second chemin de connexion à garder en phase.
const db: Database = await initDb();
console.log(`Fuseau     : ${APP_TIMEZONE}`);
console.log(`Coupure    : ${new Date(beforeTs).toISOString()}`);
console.log(`Mode       : ${apply ? 'ÉCRITURE (--apply)' : 'SIMULATION — rien ne sera écrit'}\n`);

const companies = await db.getAllCompanies();
let entriesFixed = 0, entriesSkipped = 0, entriesAlready = 0, entriesAfterCutoff = 0;
let attendanceFixed = 0, attendanceOk = 0, attendanceCollision = 0;
const samples: string[] = [];

for (const company of companies) {
  // ---- Entrées de temps : décalage, marqué et borné ------------------------
  const entries = await db.getAllTimeEntries(company.id);
  for (const e of entries) {
    if (!isDateFr(e.date) || !isHm(e.heureDebut)) { entriesSkipped++; continue; }
    if (e.tzFixedAt) { entriesAlready++; continue; }

    // La seule trace d'ancienneté que porte une entrée. Une entrée reprise
    // depuis la coupure est considérée récente : la laisser intacte est le
    // choix prudent — mieux vaut une heure non corrigée qu'une heure corrigée
    // deux fois.
    const touched = Math.max(
      Number(e.lastStartedAt) || 0,
      e.lastEditedAt ? new Date(e.lastEditedAt).getTime() : 0,
    );
    if (touched && touched >= beforeTs) { entriesAfterCutoff++; continue; }

    const [dd, mm, yyyy] = e.date.split('/').map(Number);
    const offset = offsetMinutesAt(new Date(Date.UTC(yyyy, mm - 1, dd, 12, 0)));
    if (offset === 0) { entriesSkipped++; continue; }

    const start = shift(e.date, e.heureDebut, offset);
    const updates: any = { date: start.date, heureDebut: start.time, tzFixedAt: new Date().toISOString() };
    if (isHm(e.heureFin)) updates.heureFin = shift(e.date, e.heureFin, offset).time;

    if (samples.length < 8) {
      samples.push(`   ${e.date} ${e.heureDebut}${isHm(e.heureFin) ? `–${e.heureFin}` : ''}`
        + `  ->  ${updates.date} ${updates.heureDebut}${updates.heureFin ? `–${updates.heureFin}` : ''}`);
    }
    if (apply) await db.updateTimeEntry(company.id, e.id, updates);
    entriesFixed++;
  }

  // ---- Pointage de présence : recalcul depuis l'instant --------------------
  const records = await db.getAllAttendanceRecords(company.id);
  const dayTaken = new Set(records.map((r: any) => `${r.userId}|${r.date}`));
  for (const r of records) {
    if (!r.checkinAt) { attendanceOk++; continue; }
    const checkin = new Date(r.checkinAt);
    const day = isoDay(checkin);
    const updates: any = {};
    if (r.date !== day) {
      // Deux lignes ne peuvent pas partager (utilisateur, jour) : si la place
      // est déjà prise, on signale plutôt que d'écraser.
      if (dayTaken.has(`${r.userId}|${day}`)) { attendanceCollision++; continue; }
      dayTaken.delete(`${r.userId}|${r.date}`);
      dayTaken.add(`${r.userId}|${day}`);
      updates.date = day;
    }
    if (r.shiftStart) {
      const late = minutesFromShift(r.shiftStart, checkin);
      if (r.checkinLateMinutes !== late) updates.checkinLateMinutes = late;
    }
    if (r.shiftEnd && r.checkoutAt) {
      const late = minutesFromShift(r.shiftEnd, new Date(r.checkoutAt));
      if (r.checkoutLateMinutes !== late) updates.checkoutLateMinutes = late;
    }
    if (Object.keys(updates).length === 0) { attendanceOk++; continue; }
    if (samples.length < 12) {
      samples.push(`   pointage ${r.date} retard ${r.checkinLateMinutes} min`
        + `  ->  ${updates.date || r.date} retard ${updates.checkinLateMinutes ?? r.checkinLateMinutes} min`);
    }
    if (apply) await db.updateAttendanceRecord(company.id, r.id, updates);
    attendanceFixed++;
  }
}

if (samples.length) console.log('Exemples :\n' + samples.join('\n') + '\n');
console.log('Entrées de temps');
console.log(`  corrigées                : ${entriesFixed}`);
console.log(`  déjà corrigées (marquées): ${entriesAlready}`);
console.log(`  postérieures à la coupure: ${entriesAfterCutoff}`);
console.log(`  sans date/heure lisible  : ${entriesSkipped}`);
console.log('Pointage de présence');
console.log(`  recalculées              : ${attendanceFixed}`);
console.log(`  déjà justes              : ${attendanceOk}`);
if (attendanceCollision) console.log(`  jour déjà occupé (ignoré): ${attendanceCollision}`);

if (!apply) {
  console.log('\nSimulation terminée — aucune écriture. Relancez avec --apply pour appliquer.');
} else {
  console.log('\nAppliqué.');
}
await db.close?.();
