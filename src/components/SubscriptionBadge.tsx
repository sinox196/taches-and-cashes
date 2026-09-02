import React from 'react';
import { Clock, AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { CLIENT_ROLE } from '../constants/roles';

/**
 * « 1ᵉʳ octobre 2026 », pas « 01 octobre 2026 » : en français le premier du
 * mois porte l'ordinal, et `toLocaleDateString` ne le sait pas.
 */
const frenchDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getDate();
  const rest = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return `${day === 1 ? '1ᵉʳ' : day} ${rest}`;
};

/**
 * L'état de l'**abonnement** de l'entreprise — à ne pas confondre avec le
 * badge de présence juste à côté.
 *
 * C'est précisément cette confusion qui a fait remonter le parrainage comme
 * cassé : une entreprise en essai n'affichait nulle part qu'elle était en
 * essai, pendant que le bandeau montrait « ACTIF » — qui parle de la souris et
 * du clavier, pas de l'abonnement. Un filleul tout juste inscrit se lisait donc
 * comme déjà abonné.
 *
 * Comme le badge de téléphone du pointage, il **n'apparaît que lorsqu'il y a
 * quelque chose à dire** : un abonnement payé est le cas ordinaire et
 * n'affiche rien. L'essai, lui, est une information qui a une date de
 * péremption et que tout le monde dans l'entreprise a intérêt à voir.
 *
 * Un compte du portail client en est exclu : l'abonnement du cabinet ne le
 * regarde pas.
 */
export const SubscriptionBadge: React.FC = () => {
  const { user } = useAuth();
  const company = user?.company;

  if (!company || user?.role === CLIENT_ROLE) return null;
  if (company.status !== 'TRIAL') return null;

  const daysLeft = company.trialEndsAt
    ? Math.ceil((new Date(company.trialEndsAt).getTime() - Date.now()) / 86400000)
    : null;
  const ended = daysLeft !== null && daysLeft < 0;
  const endsOn = company.trialEndsAt ? frenchDate(company.trialEndsAt) : null;

  // La phrase complète — celle que l'entreprise doit lire. Le bandeau n'a pas
  // la largeur de la porter en toutes circonstances, d'où les trois paliers
  // ci-dessous ; l'info-bulle, elle, la porte toujours en entier.
  const title = ended
    ? "Votre période d'essai est terminée — Activez votre abonnement dès maintenant."
    : `Période d'essai${endsOn ? ` jusqu'au ${endsOn}` : ''} — Activez votre abonnement dès maintenant.`;

  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${
        ended ? 'bg-late-bg text-late-fg' : 'bg-[#FFFAEB] text-[#B54708]'
      }`}
    >
      {ended ? <AlertTriangle className="w-3 h-3 shrink-0" /> : <Clock className="w-3 h-3 shrink-0" />}
      {ended ? (
        <>
          Essai terminé
          <span className="hidden lg:inline">&nbsp;— Activez votre abonnement dès maintenant</span>
        </>
      ) : (
        <>
          {/* Sous `sm` il ne reste que le compte à rebours : la date entière
              pousse l'avatar et la cloche hors du bandeau sur un téléphone. */}
          <span className="sm:hidden">{daysLeft !== null ? `Essai · ${daysLeft} j` : 'Essai'}</span>
          <span className="hidden sm:inline">
            Période d&rsquo;essai{endsOn ? ` jusqu'au ${endsOn}` : ''}
            <span className="hidden lg:inline">&nbsp;— Activez votre abonnement dès maintenant</span>
          </span>
        </>
      )}
    </span>
  );
};
