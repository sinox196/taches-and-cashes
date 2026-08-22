/**
 * Turns a caught error into UI-safe text. `fetch()` throws a bare
 * `TypeError: Failed to fetch` (or the Firefox/Safari equivalents) whenever
 * the network itself is unreachable — that string leaking to the screen reads
 * as a bug report, not a status. Everything else (a thrown `Error` with a
 * server-provided message, a plain string) passes through unchanged.
 */
export function friendlyError(e: unknown, fallback = 'Une erreur est survenue.'): string {
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  if (/Failed to fetch|NetworkError when attempting to fetch resource|Load failed/i.test(message)) {
    return 'Vous êtes actuellement hors ligne.';
  }
  return message || fallback;
}
