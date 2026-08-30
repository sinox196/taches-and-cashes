import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Gift, Copy, Check, Loader2, Users2, CalendarPlus, Ticket } from 'lucide-react';

/**
 * Parrainage.
 *
 * L'entreprise partage son lien ; si l'invité crée un compte, elle gagne un
 * mois gratuit. La forme que prend ce mois dépend de son état — essai
 * prolongé, ou avoir à valoir sur la prochaine facture — et c'est le serveur
 * qui tranche (voir `grantReferralReward` dans server.ts) ; cette page se
 * contente de dire laquelle a été appliquée.
 */

interface ReferralEntry {
  id: string;
  companyName: string;
  rewardKind: 'TRIAL_EXTENDED' | 'CREDIT';
  rewardMonths: number;
  createdAt: string;
}

interface ReferralData {
  code: string;
  link: string;
  rewardDays: number;
  creditMonths: number;
  status: string;
  trialEndsAt: string | null;
  referrals: ReferralEntry[];
}

const fdate = (iso: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const ReferralPage: React.FC = () => {
  const { token } = useAuth();
  const [data, setData] = useState<ReferralData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch('/api/referral', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => (res.ok ? res.json() : null))
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [token]);

  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.link);
    } catch {
      // navigator.clipboard exige un contexte sécurisé (https ou localhost) —
      // absent, on retombe sur la sélection manuelle plutôt que d'échouer en
      // silence : l'input est en lecture seule, pas désactivé, donc le lien
      // reste sélectionnable et copiable à la main.
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return (
      <main className="p-4 sm:p-6 lg:p-8 flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </main>
    );
  }

  if (!data) {
    return (
      <main className="p-4 sm:p-6 lg:p-8 flex-1 flex items-center justify-center text-[13px] text-gray-500">
        Le parrainage n'est pas disponible pour ce compte.
      </main>
    );
  }

  const monthsEarned = data.referrals.length;

  return (
    <main className="p-4 sm:p-6 lg:p-8 flex-1 flex flex-col gap-4 sm:gap-6 max-w-[1000px] w-full mx-auto">
      <div>
        <h1 className="text-[20px] font-bold text-gray-800 tracking-tight">Parrainage</h1>
        <p className="text-[12px] text-gray-500 mt-1">
          Invitez un confrère : dès qu'il crée son compte, vous gagnez un mois gratuit.
        </p>
      </div>

      {/* Le lien : la seule chose que l'utilisateur vient chercher ici. */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-9 h-9 rounded-full bg-turquoise/10 flex items-center justify-center shrink-0">
            <Gift className="w-4.5 h-4.5 text-turquoise" />
          </div>
          <div>
            <p className="text-[14px] font-semibold text-gray-900 leading-tight">Votre lien d'invitation</p>
            <p className="text-[12px] text-gray-500 leading-tight">Code : <span className="font-mono font-semibold text-gray-700">{data.code}</span></p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            readOnly
            value={data.link}
            onFocus={e => e.currentTarget.select()}
            className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg text-[13px] font-mono bg-gray-50 text-gray-700"
          />
          <button
            onClick={copy}
            className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold transition-colors shrink-0 ${
              copied ? 'bg-emerald-600 text-white' : 'bg-navy text-white hover:bg-navy-hover'
            }`}
          >
            {copied ? <><Check className="w-4 h-4" /> Copié</> : <><Copy className="w-4 h-4" /> Copier le lien</>}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat
          icon={Users2}
          label="Filleuls inscrits"
          value={String(monthsEarned)}
        />
        <Stat
          icon={Gift}
          label="Mois gagnés"
          value={String(monthsEarned)}
        />
        {data.status === 'TRIAL' ? (
          <Stat
            icon={CalendarPlus}
            label="Essai jusqu'au"
            value={fdate(data.trialEndsAt || '')}
            tone="good"
          />
        ) : (
          <Stat
            icon={Ticket}
            label="Mois à valoir"
            value={String(data.creditMonths)}
            tone={data.creditMonths > 0 ? 'good' : undefined}
          />
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-gray-100">
          <h2 className="text-[14px] font-semibold text-gray-900">Vos filleuls</h2>
        </div>
        {data.referrals.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-gray-500">
            Personne ne s'est encore inscrit avec votre lien.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {data.referrals.map(r => (
              <li key={r.id} className="px-4 sm:px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium text-gray-900 truncate">{r.companyName}</p>
                  <p className="text-[12px] text-gray-500">Inscrit le {fdate(r.createdAt)}</p>
                </div>
                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11.5px] font-medium bg-emerald-50 text-emerald-700 self-start shrink-0">
                  <Check className="w-3.5 h-3.5" />
                  {r.rewardKind === 'TRIAL_EXTENDED'
                    ? `+${r.rewardMonths} mois d'essai`
                    : `+${r.rewardMonths} mois à valoir`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-[11.5px] text-gray-400">
        Le mois gagné prolonge votre essai s'il est en cours, sinon il est enregistré comme un avoir
        déduit de votre prochaine échéance.
      </p>
    </main>
  );
};

const Stat: React.FC<{ icon: React.ElementType; label: string; value: string; tone?: 'good' }> = ({ icon: Icon, label, value, tone }) => (
  <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between gap-2">
    <div className="min-w-0">
      <p className="text-[12px] text-gray-500 leading-snug mb-0.5">{label}</p>
      <p className={`text-[18px] font-bold ${tone === 'good' ? 'text-emerald-700' : 'text-gray-900'}`}>{value}</p>
    </div>
    <div className="w-9 h-9 rounded-full bg-gray-50 flex items-center justify-center shrink-0">
      <Icon className="w-4 h-4 text-gray-400" />
    </div>
  </div>
);
