import React from 'react';
import { X, Smartphone, Palmtree } from 'lucide-react';
import { PRESENCE_META, formatIdle, type PresenceState } from '../constants/presence';

interface PresenceBadgeProps {
  state: PresenceState;
  idleMs?: number | null;
  /** 'dot' = marker only, 'full' = marker + label. */
  variant?: 'dot' | 'full';
  /** D'où la personne est connectée, si on le sait. */
  device?: 'MOBILE' | 'DESKTOP' | null;
  /**
   * Dernier jour (ISO `YYYY-MM-DD`) d'un congé approuvé couvrant aujourd'hui,
   * ou `null`/absent. Ce n'est pas un état de présence au sens propre — un
   * congé peut être approuvé sans que la personne ait jamais rouvert
   * l'app — mais c'est le même badge qui l'affiche partout où « qui est là »
   * se lit déjà, donc il prend le pas sur actif/absent/inactif plutôt que de
   * vivre à côté.
   */
  onLeaveUntil?: string | null;
}

/** `2026-05-31` -> `31/05/2026`, sans passer par `Date` : une date sans heure
 *  n'a pas de fuseau à respecter, et `new Date(iso)` la ferait glisser d'un
 *  jour sur un appareil dont le fuseau système n'est pas celui du cabinet. */
const formatIsoDateFR = (iso: string): string => {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

/**
 * Presence marker. Inactive is an X rather than a coloured dot so the three
 * states stay distinguishable by shape as well as colour — a dark dot and a
 * green dot are the same thing to a colourblind reader.
 */
export const PresenceBadge: React.FC<PresenceBadgeProps> = ({ state, idleMs, variant = 'full', device, onLeaveUntil }) => {
  if (onLeaveUntil) {
    const title = `En congé — de retour le ${formatIsoDateFR(onLeaveUntil)}`;
    const marker = <Palmtree className="w-3 h-3 text-pause-fg shrink-0" strokeWidth={2.5} />;
    if (variant === 'dot') {
      return <span title={title} className="inline-flex items-center gap-1">{marker}</span>;
    }
    return (
      <span
        title={title}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-pause-bg text-pause-fg"
      >
        {marker}
        En congé
      </span>
    );
  }

  const meta = PRESENCE_META[state] ?? PRESENCE_META.INACTIVE;
  const idle = state === 'AWAY' && idleMs ? ` · inactif depuis ${formatIdle(idleMs)}` : '';
  // Le poste ne se dit que tant qu'on a le contact : pour quelqu'un d'inactif,
  // le serveur ne le renvoie pas, et « était sur son téléphone » se lirait
  // comme une information à jour.
  const from = device ? ` · depuis ${device === 'MOBILE' ? 'un téléphone' : 'un ordinateur'}` : '';
  const title = `${meta.label} — ${meta.description}${idle}${from}`;

  const marker = state === 'INACTIVE'
    ? <X className="w-3 h-3 text-gray-900 shrink-0" strokeWidth={3} />
    : <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dotClass}`} />;

  // Même règle que le badge du pointage : l'icône n'apparaît que lorsqu'un
  // téléphone est en jeu. Le poste fixe est le cas ordinaire, et en marquer
  // chaque ligne ferait du bruit — c'est l'apparition de l'icône qui est le
  // signal.
  const phone = device === 'MOBILE'
    ? <Smartphone className="w-3 h-3 shrink-0 text-gray-500" strokeWidth={2.5} />
    : null;

  if (variant === 'dot') {
    return (
      <span title={title} className="inline-flex items-center gap-1">
        {marker}
        {phone}
      </span>
    );
  }

  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${meta.badgeClass}`}
    >
      {marker}
      {meta.label}
      {phone}
    </span>
  );
};
