/**
 * Le fuseau du cabinet, côté navigateur — la contrepartie client de
 * `APP_TIMEZONE` dans server.ts.
 *
 * Un instant (`checkinAt`, `lastEditedAt`, l'horodatage d'un message…) est
 * stocké en ISO/UTC et, par défaut, `toLocaleTimeString()` le rend dans le
 * fuseau *du navigateur* — celui de l'appareil qui regarde, pas celui du
 * cabinet. Ça tient tant que l'appareil est correctement réglé sur
 * Africa/Tunis, et ça casse net sinon : un poste dont l'horloge système est
 * en UTC (une VM, un kiosque, un fuseau mal détecté) affiche une heure
 * décalée d'une heure pile — exactement le symptôme du fuseau du cabinet
 * étant UTC+1. La comparaison avec Pointage, dont l'heure de début est une
 * chaîne déjà écrite en heure de Tunis côté serveur, rend le décalage
 * flagrant : les deux écrans parlent du même instant et ne s'accordent pas.
 *
 * `formatTimeTN`/`formatDateTimeTN` épinglent donc le fuseau explicitement,
 * plutôt que de faire confiance à l'appareil qui regarde.
 */
export const APP_TIMEZONE = 'Africa/Tunis';

/** « 08:56 » — l'heure d'un instant ISO, dans le fuseau du cabinet. */
export function formatTimeTN(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: APP_TIMEZONE });
}

/** « 03/09/2026 08:56 » — jour puis heure d'un instant ISO, fuseau du cabinet. */
export function formatDateTimeTN(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('fr-FR', { timeZone: APP_TIMEZONE });
  const time = formatTimeTN(iso);
  return `${date} ${time}`;
}

/**
 * « 2026-09-03 » — le jour civil du cabinet pour un instant ISO, en clé
 * triable. Sert à comparer deux instants « même jour ? » (aujourd'hui, hier)
 * sans retomber sur `toDateString()`, qui découpe la journée dans le fuseau
 * de l'appareil : un message envoyé à 00h15 heure de Tunis (23h15 UTC la
 * veille) se rangerait sous la mauvaise journée sur un appareil resté en UTC.
 */
export function civilDateKeyTN(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  // en-CA rend directement YYYY-MM-DD, sans avoir à réassembler les parts.
  return d.toLocaleDateString('en-CA', { timeZone: APP_TIMEZONE });
}

/**
 * Formats seconds into HH:MM:SS string
 */
export function formatHHMMSS(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (num: number) => num.toString().padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Formats seconds into verbose duration string like "2h 35m 15s"
 */
export function formatVerboseDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (seconds > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  return `${hours}h ${minutes}m`;
}

/**
 * Formats an already-computed cost as "XX,YYY DT"
 */
export function formatCostDT(cost: number): string {
  const formatted = (cost || 0).toLocaleString('fr-FR', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
  return `${formatted} DT`;
}

/**
 * Calculates DT cost from a duration and the collaborator's employer hourly cost.
 * The rate is required on purpose — there is no sensible default, and inventing
 * one silently mis-prices everyone who has no cost configured.
 */
export function calculateCostDT(totalSeconds: number, ratePerHour: number): string {
  const hours = totalSeconds / 3600;
  return formatCostDT(hours * ratePerHour);
}

/**
 * Formats duration in hours and minutes (e.g. 42h30 or 0h00)
 */
export function formatDurationHoursMinutes(totalSeconds: number): string {
  const hours = Math.floor((totalSeconds || 0) / 3600);
  const minutes = Math.floor(((totalSeconds || 0) % 3600) / 60);
  return `${hours}h${String(minutes).padStart(2, '0')}`;
}

/**
 * Formats cost in TND (e.g. 1 250 TND or 980 TND or 0 TND)
 */
export function formatCostTND(cost: number): string {
  const val = cost || 0;
  // If integer or >= 100, show grouped integer format like 1 250 TND
  if (val % 1 === 0 || val >= 100) {
    return `${Math.round(val).toLocaleString('fr-FR')} TND`;
  }
  return `${val.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 3 })} TND`;
}
