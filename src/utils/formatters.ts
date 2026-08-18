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
