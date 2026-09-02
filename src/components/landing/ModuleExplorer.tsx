import React, { useState } from 'react';
import {
  LayoutDashboard, CalendarCheck, Users, MessageSquare, Gift, Building2,
} from 'lucide-react';

/**
 * Le tour des modules que la page ne montre pas déjà en grand (le pointage et
 * la facturation ont chacun leur section).
 *
 * Un panneau à onglets plutôt que six sections empilées : six modules de plus
 * en pleine largeur feraient une page qu'on ne finit pas, et ces écrans se
 * comparent — on veut pouvoir passer de l'un à l'autre, pas les faire défiler.
 *
 * Les maquettes sont dessinées en HTML, pas en images : elles suivent les
 * tokens de la charte, restent nettes sur tout écran, et un libellé qui change
 * dans l'application se corrige ici sans repasser par un export.
 */
interface ModuleTab {
  id: string;
  label: string;
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  points: string[];
  mock: React.ReactNode;
}

const Panel: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`bg-white rounded-2xl border border-[#E6E9EE] p-4 sm:p-5 ${className}`}>{children}</div>
);

const Pill: React.FC<{ children: React.ReactNode; tone: 'done' | 'late' | 'run' | 'gray' }> = ({ children, tone }) => {
  const tones = {
    done: 'bg-[#E7F8EE] text-[#15803D]',
    late: 'bg-[#FDECEC] text-[#B91C1C]',
    run: 'bg-[#E4F1FE] text-[#1D4ED8]',
    gray: 'bg-[#F2F4F7] text-[#6B7480]',
  } as const;
  return <span className={`inline-block px-2 py-[3px] rounded-md text-[9.5px] font-bold whitespace-nowrap ${tones[tone]}`}>{children}</span>;
};

const DashboardMock = () => (
  <Panel>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
      {[
        { k: 'Honoraires', v: '48 200 DT', c: 'text-navy' },
        { k: 'Coût employeur', v: '21 940 DT', c: 'text-navy' },
        { k: 'Marge sur temps', v: '+26 260 DT', c: 'text-[#15803D]' },
        { k: 'Taux de marge', v: '54,5 %', c: 'text-[#00857C]' },
      ].map(c => (
        <div key={c.k} className="bg-[#F8FAFB] border border-[#EEF1F4] rounded-xl px-3 py-2.5">
          <div className="text-[8.5px] font-bold uppercase tracking-[0.05em] text-[#8A93A0]">{c.k}</div>
          <div className={`text-[13px] font-extrabold mt-1 tabular-nums ${c.c}`}>{c.v}</div>
        </div>
      ))}
    </div>
    {/* `items-stretch` (le défaut) et non `items-end` : une colonne alignée
        en bas prend sa hauteur de contenu, et les hauteurs en pourcentage des
        barres n'ont alors rien contre quoi se résoudre — le graphique
        disparaissait. */}
    <div className="mt-3 flex gap-[7px] h-[86px] px-1">
      {[42, 61, 35, 78, 54, 88, 47, 69, 96, 58, 74, 82].map((h, i) => (
        <div key={i} className="flex-1 flex flex-col justify-end gap-[3px]">
          <div className="w-full rounded-t-[3px] bg-[#2a78d6]" style={{ height: `${h * 0.6}%` }} />
          <div className="w-full rounded-b-[3px] bg-[#eb6834]" style={{ height: `${h * 0.28}%` }} />
        </div>
      ))}
    </div>
    <div className="mt-3 flex items-center gap-3 text-[9px] font-semibold text-[#8A93A0]">
      <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[2px] bg-[#2a78d6]" /> Honoraires</span>
      <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[2px] bg-[#eb6834]" /> Coût du temps</span>
    </div>
    <div className="mt-3 flex items-center gap-2 bg-[#FFF7ED] border border-[#FED7AA] rounded-lg px-3 py-2">
      <span className="w-1.5 h-1.5 rounded-full bg-[#F97316] shrink-0" />
      <span className="text-[10px] font-semibold text-[#9A3412]">3 clients sous le seuil de marge · 2 créances échues</span>
    </div>
  </Panel>
);

const EcheancesMock = () => (
  <Panel className="overflow-hidden">
    <div className="text-[9px] font-bold uppercase tracking-[0.05em] text-[#8A93A0] mb-2">Suivi mensuel · Exercice 2026</div>
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr>
            {['Client', 'DM 12/2025', 'IS 2025', 'CNSS TR01', 'Acompte 1'].map(h => (
              <th key={h} className="border border-[#EEF1F4] bg-[#F8FAFB] px-2 py-1.5 text-[8.5px] font-bold uppercase tracking-[0.03em] text-[#8A93A0] whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[
            ['ALPHA SARL', 'done', 'done', 'done', 'run'],
            ['BETA CONSEIL', 'done', 'late', 'done', 'gray'],
            ['GAMMA SERVICES', 'done', 'done', 'run', 'gray'],
          ].map(([name, ...cells]) => (
            <tr key={name as string}>
              <td className="border border-[#EEF1F4] px-2 py-1.5 text-[10px] font-bold text-navy whitespace-nowrap">{name}</td>
              {(cells as ('done' | 'late' | 'run' | 'gray')[]).map((tone, i) => (
                <td key={i} className="border border-[#EEF1F4] px-2 py-1.5 text-center">
                  <Pill tone={tone}>{tone === 'done' ? 'Oui' : tone === 'late' ? 'DEFAUT' : tone === 'run' ? 'Préparée' : '—'}</Pill>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </Panel>
);

const PortalMock = () => (
  <Panel>
    <div className="flex items-center justify-between">
      <div>
        <div className="text-[8.5px] font-bold uppercase tracking-[0.05em] text-[#8A93A0]">Espace client</div>
        <div className="text-[13px] font-extrabold text-navy mt-0.5">ALPHA SARL</div>
      </div>
      <div className="text-right">
        <div className="text-[8.5px] font-bold uppercase tracking-[0.05em] text-[#8A93A0]">Solde</div>
        <div className="text-[13px] font-extrabold text-[#B91C1C] mt-0.5 tabular-nums">1 240,000 DT</div>
      </div>
    </div>
    <div className="mt-3 border border-[#EEF1F4] rounded-xl overflow-hidden">
      <div className="grid grid-cols-[1fr_0.7fr_0.7fr] px-3 py-1.5 bg-[#F8FAFB] text-[8.5px] font-bold uppercase tracking-[0.03em] text-[#8A93A0]">
        <span>Libellé</span><span className="text-right">Débit</span><span className="text-right">Solde</span>
      </div>
      {[
        ['Solde antérieur', '', '0,000'],
        ['Facture n° 0006', '2 856,000', '2 856,000'],
        ['Règlement — virement', '− 1 616,000', '1 240,000'],
      ].map(([l, d, s], i) => (
        <div key={l} className={`grid grid-cols-[1fr_0.7fr_0.7fr] px-3 py-[7px] text-[10px] text-[#3D4655] font-semibold ${i ? 'border-t border-[#F2F4F7]' : ''}`}>
          <span>{l}</span><span className="text-right tabular-nums">{d}</span><span className="text-right tabular-nums font-bold text-navy">{s}</span>
        </div>
      ))}
    </div>
    <div className="mt-3 flex items-center gap-2 bg-[#E3F7F5] rounded-lg px-3 py-2">
      <span className="text-[10px] font-semibold text-[#00857C]">Avancement des dossiers visible — sans aucun temps ni coût interne</span>
    </div>
  </Panel>
);

const HrMock = () => (
  <Panel>
    <div className="grid grid-cols-3 gap-2.5">
      {[
        { k: 'Solde congés', v: '18 j' },
        { k: 'Pris', v: '12 j' },
        { k: 'En attente', v: '2' },
      ].map(c => (
        <div key={c.k} className="bg-[#F8FAFB] border border-[#EEF1F4] rounded-xl px-3 py-2.5">
          <div className="text-[8.5px] font-bold uppercase tracking-[0.05em] text-[#8A93A0]">{c.k}</div>
          <div className="text-[14px] font-extrabold text-navy mt-1">{c.v}</div>
        </div>
      ))}
    </div>
    <div className="mt-3 border border-[#EEF1F4] rounded-xl overflow-hidden">
      {[
        { n: 'Congé annuel · 5 j', d: '12 → 16 août', t: 'done' as const, s: 'Approuvé' },
        { n: 'Autorisation · 2 h', d: '3 sept · 14h00', t: 'run' as const, s: 'En attente' },
        { n: 'Avance sur salaire', d: '400,000 DT', t: 'done' as const, s: 'Accordée' },
      ].map((r, i) => (
        <div key={r.n} className={`flex items-center justify-between px-3 py-[9px] ${i ? 'border-t border-[#F2F4F7]' : ''}`}>
          <div>
            <div className="text-[10.5px] font-bold text-navy">{r.n}</div>
            <div className="text-[9px] text-[#8A93A0] mt-0.5">{r.d}</div>
          </div>
          <Pill tone={r.t}>{r.s}</Pill>
        </div>
      ))}
    </div>
  </Panel>
);

const ChatMock = () => (
  <Panel>
    <div className="flex items-center gap-2.5 pb-2.5 border-b border-[#F2F4F7]">
      <div className="relative">
        <div className="w-8 h-8 rounded-full bg-navy text-white text-[10px] font-extrabold flex items-center justify-center">SM</div>
        <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#22C55E] border-2 border-white" />
      </div>
      <div>
        <div className="text-[11px] font-bold text-navy">Équipe — Clôture août</div>
        <div className="text-[9px] text-[#22C55E] font-semibold">3 membres · 2 actifs</div>
      </div>
    </div>
    <div className="mt-3 flex flex-col gap-2">
      <div className="self-start max-w-[80%] bg-[#F2F4F7] rounded-2xl rounded-bl-md px-3 py-2">
        <div className="text-[10px] text-[#3D4655]">La liasse ALPHA est prête pour relecture.</div>
      </div>
      <div className="self-end max-w-[80%] bg-navy rounded-2xl rounded-br-md px-3 py-2">
        <div className="text-[10px] text-white">Reçu — je valide avant la DM de demain.</div>
        <div className="text-[8px] text-turquoise text-right mt-0.5 font-bold">✓✓</div>
      </div>
      <div className="self-start max-w-[80%] bg-[#F2F4F7] rounded-2xl rounded-bl-md px-3 py-2">
        <div className="text-[10px] text-[#3D4655]">J'ajoute la pièce au dossier client.</div>
      </div>
    </div>
  </Panel>
);

const ReferralMock = () => (
  <Panel>
    <div className="text-[8.5px] font-bold uppercase tracking-[0.05em] text-[#8A93A0]">Votre lien de parrainage</div>
    <div className="mt-2 flex items-center gap-2 bg-[#F8FAFB] border border-[#E6E9EE] rounded-xl px-3 py-2.5">
      <span className="text-[10.5px] font-mono font-bold text-navy truncate">taches-and-cash.com/?ref=<span className="text-turquoise">K7RXM2</span></span>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2.5">
      <div className="bg-[#E3F7F5] rounded-xl px-3 py-3 text-center">
        <div className="text-[18px] font-extrabold text-[#00857C]">10 %</div>
        <div className="text-[9px] font-semibold text-[#00857C] mt-0.5">de remise pour le filleul</div>
      </div>
      <div className="bg-navy rounded-xl px-3 py-3 text-center">
        <div className="text-[18px] font-extrabold text-turquoise">1 mois</div>
        <div className="text-[9px] font-semibold text-white/70 mt-0.5">offert pour vous</div>
      </div>
    </div>
    <div className="mt-3 border border-[#EEF1F4] rounded-xl overflow-hidden">
      {[
        { n: 'Cabinet Nord', t: 'done' as const, s: 'Confirmé' },
        { n: 'Fiduciaire Sud', t: 'run' as const, s: 'En attente' },
      ].map((r, i) => (
        <div key={r.n} className={`flex items-center justify-between px-3 py-2 ${i ? 'border-t border-[#F2F4F7]' : ''}`}>
          <span className="text-[10px] font-bold text-navy">{r.n}</span>
          <Pill tone={r.t}>{r.s}</Pill>
        </div>
      ))}
    </div>
  </Panel>
);

const TABS: ModuleTab[] = [
  {
    id: 'dashboard',
    label: 'Tableau de bord',
    icon: <LayoutDashboard className="w-4 h-4" />,
    eyebrow: 'Direction',
    title: 'La marge sur temps, pas seulement le chiffre d’affaires',
    description:
      'Honoraires facturés moins le coût réel du temps passé. Le seul indicateur qui dit si une mission vaut ce qu’elle rapporte.',
    points: [
      'Chaque tâche chiffrée au taux en vigueur le jour où elle a été saisie',
      'Rentabilité par client, concentration du portefeuille, créances échues',
      'Alertes sur les clients sous le seuil de marge',
      'Les tâches sans taux sont comptées à part, jamais estimées',
    ],
    mock: <DashboardMock />,
  },
  {
    id: 'echeances',
    label: 'Échéances',
    icon: <CalendarCheck className="w-4 h-4" />,
    eyebrow: 'Obligations fiscales',
    title: 'Le suivi mensuel du cabinet, tel que vous le tenez déjà',
    description:
      'Une colonne par échéance, une ligne par client, une case par obligation. Les exercices 2025 à 2028 sont livrés avec les libellés à jour.',
    points: [
      'DM, IS, IRPP, CNSS, acomptes, D SUSP TVA, bilan RNE',
      'Vocabulaire de statuts modifiable — Oui, DEFAUT, Préparée, Non concerné',
      'Vue par client pour lire une année d’un coup d’œil',
      'Consultable par toute l’équipe, modifiable par les responsables',
    ],
    mock: <EcheancesMock />,
  },
  {
    id: 'portail',
    label: 'Portail client',
    icon: <Building2 className="w-4 h-4" />,
    eyebrow: 'Vos clients',
    title: 'Votre client consulte son compte sans vous appeler',
    description:
      'Son relevé, ses factures, ses règlements et l’avancement de ses dossiers — dans un espace qui ne montre jamais votre temps ni vos coûts.',
    points: [
      'Relevé de compte chronologique avec le solde qui court',
      'Avancement des livrables, sans aucune donnée interne',
      'Messagerie directe avec le cabinet',
      'Les chiffres viennent des mêmes calculs que votre back-office',
    ],
    mock: <PortalMock />,
  },
  {
    id: 'rh',
    label: 'Ressources humaines',
    icon: <Users className="w-4 h-4" />,
    eyebrow: 'Équipe',
    title: 'Congés, autorisations, prêts et avances au même endroit',
    description:
      'Une demande part vers l’approbateur choisi, la décision revient à son auteur, et le solde de congés se met à jour tout seul.',
    points: [
      'Solde annuel par collaborateur, décompté à l’approbation',
      'Autorisations d’absence, prêts et avances sur salaire',
      'Notification à l’approbateur, puis retour au demandeur',
      'Filtres par année et par mois, export CSV sur chaque onglet',
    ],
    mock: <HrMock />,
  },
  {
    id: 'messagerie',
    label: 'Messagerie',
    icon: <MessageSquare className="w-4 h-4" />,
    eyebrow: 'Collaboration',
    title: 'Les échanges de l’équipe restent dans le dossier',
    description:
      'Fils directs et conversations de groupe, avec la présence de chacun et les notifications qui suivent — même navigateur fermé.',
    points: [
      'Groupes de travail, accusés de lecture sur les fils directs',
      'Présence en direct : actif, absent, inactif',
      'Notifications poussées sur mobile et sur poste',
      'Les notes internes restent hors de portée d’un compte client',
    ],
    mock: <ChatMock />,
  },
  {
    id: 'parrainage',
    label: 'Parrainage',
    icon: <Gift className="w-4 h-4" />,
    eyebrow: 'Croissance',
    title: 'Un confrère vous rejoint, vous gagnez un mois',
    description:
      'Partagez votre lien : votre filleul obtient 10 % sur son premier abonnement, et vous un mois offert — le jour où il souscrit.',
    points: [
      'Rien n’est accordé à la simple inscription : la récompense suit le paiement',
      'Code court, dictable au téléphone',
      'Suivi de vos filleuls, en attente puis confirmés',
      'Réservé aux abonnements actifs',
    ],
    mock: <ReferralMock />,
  },
];

export const ModuleExplorer: React.FC<{ onCta: () => void }> = ({ onCta }) => {
  const [active, setActive] = useState(TABS[0].id);
  const tab = TABS.find(t => t.id === active) ?? TABS[0];

  return (
    <div className="max-w-[1200px] mx-auto">
      {/* Barre d'onglets : elle défile horizontalement sur mobile plutôt que
          de passer à la ligne en trois rangées qui repoussent le panneau
          hors de l'écran. */}
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
        {TABS.map(t => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              aria-pressed={on}
              className={`snap-start shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13.5px] font-bold transition-colors border ${
                on
                  ? 'bg-navy text-white border-navy shadow-[0_8px_20px_rgba(13,27,42,0.18)]'
                  : 'bg-white text-[#3D4655] border-[#E6E9EE] hover:border-navy hover:text-navy'
              }`}
            >
              {t.icon}
              <span className="whitespace-nowrap">{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* `key` sur le panneau : le remontage rejoue l'animation d'entrée à
          chaque changement d'onglet, ce qu'une simple transition CSS sur un
          contenu remplacé ne ferait pas. */}
      <div
        key={tab.id}
        className="mt-7 grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center animate-[landingPanelIn_500ms_cubic-bezier(0.16,1,0.3,1)]"
      >
        <div>
          <div className="inline-flex px-3.5 py-1.5 bg-[#E3F7F5] rounded-full text-[11.5px] font-bold tracking-[0.06em] uppercase text-[#00857C]">
            {tab.eyebrow}
          </div>
          <h3 className="mt-4 text-[24px] sm:text-[29px] font-extrabold text-navy tracking-[-0.01em] leading-[1.2]">
            {tab.title}
          </h3>
          <p className="mt-4 text-[15px] leading-[1.65] text-[#5B6472] max-w-[470px]">{tab.description}</p>
          <div className="mt-6 flex flex-col gap-3">
            {tab.points.map(p => (
              <div key={p} className="flex items-start gap-3">
                <span className="mt-[3px] w-[18px] h-[18px] rounded-full bg-navy text-white text-[10px] font-extrabold flex items-center justify-center shrink-0">✓</span>
                <span className="text-[14px] leading-[1.5] text-[#3D4655]">{p}</span>
              </div>
            ))}
          </div>
          <button
            onClick={onCta}
            className="mt-7 px-6 py-3.5 rounded-xl text-[14.5px] font-bold text-white bg-navy hover:bg-turquoise transition-colors"
          >
            Essayer gratuitement
          </button>
        </div>

        <div className="relative">
          <div
            className="absolute -inset-6 rounded-[32px] -z-10"
            style={{ background: 'radial-gradient(circle at 60% 40%, rgba(0,179,166,0.16), rgba(0,179,166,0) 70%)' }}
          />
          {tab.mock}
        </div>
      </div>
    </div>
  );
};
