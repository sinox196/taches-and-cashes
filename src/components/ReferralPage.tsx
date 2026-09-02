import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Gift, Copy, Check, Loader2, Users2, Ticket, Lock, Hourglass } from 'lucide-react';

/**
 * Parrainage.
 *
 * Deux règles décident de tout ce que cette page affiche, et les deux sont
 * appliquées par le serveur — l'écran ne fait que les rendre lisibles :
 *
 *  - **seule une entreprise abonnée peut parrainer** : sans abonnement actif
 *    il n'y a pas de lien du tout (`eligible: false`), et la page le dit au
 *    lieu d'afficher un lien que l'inscription refuserait ;
 *  - **rien n'est gagné à l'inscription du filleul** : il faut qu'il souscrive.
 *    Un filleul inscrit mais pas encore abonné est donc « en attente », pas un
 *    mois acquis — compter les inscrits comme des mois gagnés promettrait ce
 *    qui n'a pas été accordé.
 *
 * De son côté le filleul obtient 10 % de remise sur son premier abonnement.
 */

interface ReferralEntry {
  id: string;
  companyName: string;
  /** PENDING tant que le filleul n'a pas souscrit ; CONFIRMED une fois le mois accordé. */
  status: 'PENDING' | 'CONFIRMED';
  rewardKind?: 'TRIAL_EXTENDED' | 'CREDIT';
  rewardMonths: number;
  createdAt: string;
  confirmedAt: string | null;
}

interface ReferralData {
  /** L'abonnement est actif : le parrainage est ouvert. */
  eligible: boolean;
  code: string;
  link: string;
  rewardDays: number;
  discountPercent: number;
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

  // Un mois n'est gagné que par un filleul qui a réellement souscrit — les
  // autres sont encore en attente. Compter les inscrits comme des mois gagnés
  // afficherait une récompense que le serveur n'a pas accordée.
  const confirmed = data.referrals.filter(r => r.status === 'CONFIRMED').length;
  const pending = data.referrals.length - confirmed;

  return (
    <main className="p-4 sm:p-6 lg:p-8 flex-1 flex flex-col gap-4 sm:gap-6 max-w-[1000px] w-full mx-auto">
      <div>
        <h1 className="text-[20px] font-bold text-gray-800 tracking-tight">
          Parrainez vos confrères. Gagnez de l&rsquo;argent. 💰
        </h1>
        <p className="text-[12.5px] text-gray-500 mt-1.5 leading-relaxed max-w-[70ch]">
          Partagez votre lien de parrainage avec vos confrères : ils bénéficient de {data.discountPercent} % de
          réduction sur leur abonnement, et vous gagnez une commission équivalente à 1 mois d&rsquo;abonnement pour
          chaque nouveau client qui s&rsquo;abonne grâce à vous.
        </p>
        <p className="text-[12.5px] font-semibold text-turquoise mt-1">Plus vous parrainez, plus vous gagnez !</p>
      </div>

      {/* Le lien : la seule chose que l'utilisateur vient chercher ici — sauf
          si son propre abonnement n'est pas actif, auquel cas il n'y en a
          pas, et le dire vaut mieux que montrer un lien sans valeur. */}
      {!data.eligible ? (
        <div className="bg-white border border-gray-200 rounded-xl p-5 flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
            <Lock className="w-4.5 h-4.5 text-gray-400" />
          </div>
          <div>
            <p className="text-[14px] font-semibold text-gray-900 leading-tight">
              Le parrainage s&rsquo;active avec votre abonnement
            </p>
            <p className="text-[12.5px] text-gray-500 mt-1 leading-relaxed">
              Dès que votre abonnement est actif, votre lien de parrainage est automatiquement créé. Partagez-le
              avec vos confrères : ils bénéficient de {data.discountPercent} % de réduction et vous gagnez une
              commission équivalente à 1 mois d&rsquo;abonnement pour chaque nouvelle souscription.
            </p>
          </div>
        </div>
      ) : (
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

          {/* L'argument à coller avec le lien. Il vit ici plutôt qu'en tête de
              page parce que c'est au moment de partager qu'on en a besoin. */}
          <p className="mt-3 text-[12.5px] font-medium text-[#00857C] bg-[#E3F7F5] rounded-lg px-3 py-2.5 leading-relaxed">
            Parrainage : {data.discountPercent} % de remise pour votre confrère — 1 mois gratuit pour vous dès
            qu&rsquo;il devient abonné !
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Stat icon={Users2} label="Filleuls inscrits" value={String(data.referrals.length)} />
        <Stat icon={Hourglass} label="En attente d'abonnement" value={String(pending)} />
        <Stat icon={Gift} label="Mois gagnés" value={String(confirmed)} tone={confirmed > 0 ? 'good' : undefined} />
        <Stat
          icon={Ticket}
          label="Mois à valoir"
          value={String(data.creditMonths)}
          tone={data.creditMonths > 0 ? 'good' : undefined}
        />
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
                  <p className="text-[12px] text-gray-500">
                    Inscrit le {fdate(r.createdAt)}
                    {r.status === 'CONFIRMED' && r.confirmedAt && ` — abonné le ${fdate(r.confirmedAt)}`}
                  </p>
                </div>
                {r.status === 'CONFIRMED' ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11.5px] font-medium bg-emerald-50 text-emerald-700 self-start shrink-0">
                    <Check className="w-3.5 h-3.5" />
                    {r.rewardKind === 'TRIAL_EXTENDED'
                      ? `+${r.rewardMonths} mois d'essai`
                      : `+${r.rewardMonths} mois à valoir`}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11.5px] font-medium bg-amber-50 text-amber-700 self-start shrink-0">
                    <Hourglass className="w-3.5 h-3.5" />
                    En attente d'abonnement
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-[11.5px] text-gray-400 leading-relaxed">
        À noter : votre commission est acquise uniquement lorsque la personne parrainée souscrit effectivement à
        un abonnement, et non lors de la simple création de son compte. Une inscription sans souscription ne
        génère aucune commission.
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
