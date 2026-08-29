import React from 'react';
import { Smartphone, Monitor } from 'lucide-react';
import { TimeEntry } from '../types';

/**
 * Where a task was worked from — a phone or a computer.
 *
 * Only ever drawn when a phone is involved, on either end: a task started at
 * a desk and edited at a desk is the ordinary case and adding an icon to
 * every one of those rows would be noise on a table that is already dense.
 * So the badge appearing at all *is* the signal.
 *
 * The device is whatever the browser reported on the request that created or
 * last changed the entry (see `deviceFromRequest` in server.ts). Browsers
 * self-report it and it can be spoofed, so this reads the timesheet — it
 * never decides anything.
 */
export const EntryDeviceBadge: React.FC<{ entry: TimeEntry }> = ({ entry }) => {
  const startedOnPhone = entry.createdVia === 'MOBILE';
  const editedOnPhone = entry.lastEditedVia === 'MOBILE';
  if (!startedOnPhone && !editedOnPhone) return null;

  // The edit is the more recent fact, so it wins the icon when the two
  // disagree; the tooltip still spells out both.
  const showsPhone = entry.lastEditedVia ? editedOnPhone : startedOnPhone;
  const Icon = showsPhone ? Smartphone : Monitor;

  const label = (v?: string) => (v === 'MOBILE' ? 'téléphone' : 'ordinateur');
  const lines: string[] = [];
  if (entry.createdVia) lines.push(`Démarrée depuis un ${label(entry.createdVia)}`);
  if (entry.lastEditedVia) {
    const who = entry.lastEditedByName && entry.lastEditedByName !== entry.userName
      ? ` par ${entry.lastEditedByName}`
      : '';
    const when = entry.lastEditedAt
      ? ` le ${new Date(entry.lastEditedAt).toLocaleDateString('fr-FR')} à ${new Date(entry.lastEditedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
      : '';
    lines.push(`Modifiée depuis un ${label(entry.lastEditedVia)}${who}${when}`);
  }

  return (
    <span
      title={lines.join('\n')}
      aria-label={lines.join('. ')}
      className={`inline-flex items-center justify-center w-4 h-4 rounded shrink-0 ${
        showsPhone ? 'text-turquoise bg-turquoise/10' : 'text-gray-400 bg-gray-100'
      }`}
    >
      <Icon className="w-2.5 h-2.5" />
    </span>
  );
};
