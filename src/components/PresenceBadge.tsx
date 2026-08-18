import React from 'react';
import { X } from 'lucide-react';
import { PRESENCE_META, formatIdle, type PresenceState } from '../constants/presence';

interface PresenceBadgeProps {
  state: PresenceState;
  idleMs?: number | null;
  /** 'dot' = marker only, 'full' = marker + label. */
  variant?: 'dot' | 'full';
}

/**
 * Presence marker. Inactive is an X rather than a coloured dot so the three
 * states stay distinguishable by shape as well as colour — a dark dot and a
 * green dot are the same thing to a colourblind reader.
 */
export const PresenceBadge: React.FC<PresenceBadgeProps> = ({ state, idleMs, variant = 'full' }) => {
  const meta = PRESENCE_META[state] ?? PRESENCE_META.INACTIVE;
  const idle = state === 'AWAY' && idleMs ? ` · inactif depuis ${formatIdle(idleMs)}` : '';
  const title = `${meta.label} — ${meta.description}${idle}`;

  const marker = state === 'INACTIVE'
    ? <X className="w-3 h-3 text-gray-900 shrink-0" strokeWidth={3} />
    : <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dotClass}`} />;

  if (variant === 'dot') {
    return <span title={title} className="inline-flex items-center">{marker}</span>;
  }

  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${meta.badgeClass}`}
    >
      {marker}
      {meta.label}
    </span>
  );
};
