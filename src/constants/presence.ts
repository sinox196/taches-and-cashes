/**
 * User presence.
 *
 * ACTIVE   — using the mouse or keyboard
 * AWAY     — no input for AWAY_AFTER_MS (returns to ACTIVE on the next input)
 * INACTIVE — no heartbeat at all: tab closed, logged out, or the machine is off
 *
 * The server decides the state from the last heartbeat and the reported idle
 * time; the client never declares its own status. "The PC is off" is only
 * observable as an *absence* of heartbeats, which no client can report.
 */
export type PresenceState = 'ACTIVE' | 'AWAY' | 'INACTIVE';

/** Idle time after which a connected user is considered away. */
export const AWAY_AFTER_MS = 10 * 60 * 1000;

/** How often the browser reports in. */
export const HEARTBEAT_MS = 30 * 1000;

/**
 * Silence after which a user is considered inactive. Deliberately a little over
 * three heartbeats so one dropped request or a brief network blip doesn't make
 * somebody vanish.
 */
export const OFFLINE_AFTER_MS = 95 * 1000;

export const PRESENCE_META: Record<PresenceState, {
  label: string;
  /** Tailwind classes for the dot / marker. */
  dotClass: string;
  /** Tailwind classes for a text badge. */
  badgeClass: string;
  description: string;
}> = {
  ACTIVE: {
    label: 'Actif',
    dotClass: 'bg-[#12B76A]',
    badgeClass: 'bg-[#ECFDF3] text-[#027A48]',
    description: 'Utilise la souris ou le clavier',
  },
  AWAY: {
    label: 'Absent',
    dotClass: 'bg-[#F79009]',
    badgeClass: 'bg-[#FFFAEB] text-[#B54708]',
    description: 'Aucune activité souris/clavier depuis plus de 10 minutes',
  },
  INACTIVE: {
    label: 'Inactif',
    dotClass: 'bg-gray-900',
    badgeClass: 'bg-gray-100 text-gray-700',
    description: 'Poste éteint ou session fermée',
  },
};

/** Human-readable idle duration, e.g. "12 min". */
export function formatIdle(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
