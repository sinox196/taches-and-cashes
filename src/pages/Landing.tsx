import React, { useState, useEffect } from 'react';
import { Mail } from 'lucide-react';
import { Logo } from '../components/Logo';
import { RequestAccessModal } from '../components/landing/RequestAccessModal';

const CONTACT_EMAIL = 'contact@taches-and-cash.com';

interface PricingPlan {
  name: string;
  tagline: string;
  price: string;
  period?: string;
  seats: string;
  features: string[];
  cta: string;
  highlighted?: boolean;
}

const PLANS: PricingPlan[] = [
  {
    name: 'Freelance',
    tagline: 'Pour un indépendant qui démarre',
    price: 'Gratuit',
    seats: '1 utilisateur',
    features: [
      'Toutes les vues et fonctionnalités accessibles',
      'Suivi du temps & gestion des tâches',
      'Facturation & trésorerie',
    ],
    cta: 'Commencer gratuitement',
  },
  {
    name: 'Équipe',
    tagline: 'Pour les petites équipes',
    price: '50 DT',
    period: '/mois',
    seats: "Jusqu'à 5 utilisateurs",
    features: [
      'Toutes les vues et fonctionnalités accessibles',
      'Suivi du temps & gestion des tâches',
      'Facturation & trésorerie',
      "Tableau de bord & performance d'équipe",
    ],
    cta: 'Essai gratuit',
    highlighted: true,
  },
  {
    name: 'Croissance',
    tagline: 'Pour les équipes en expansion',
    price: '80 DT',
    period: '/mois',
    seats: "Jusqu'à 10 utilisateurs",
    features: [
      'Toutes les vues et fonctionnalités accessibles',
      'Suivi du temps & gestion des tâches',
      'Facturation & trésorerie',
      "Tableau de bord & performance d'équipe",
    ],
    cta: 'Essai gratuit',
  },
];

const HOME_FEATURES: { title: string; description: string; iconBg: string; icon: React.ReactNode }[] = [
  {
    title: 'Gestion des tâches',
    description: 'Créez, assignez et suivez les tâches de vos équipes en temps réel.',
    iconBg: '#E9ECFE',
    icon: <div className="w-4 h-4 bg-navy rounded" />,
  },
  {
    title: 'Suivi du temps',
    description: 'Chronométrez chaque mission facturable ou non, automatiquement.',
    iconBg: '#E3F7F5',
    icon: <div className="w-4 h-4 rounded-full border-[2.5px] border-turquoise" />,
  },
  {
    title: "Performance d'équipe",
    description: 'Visualisez la charge et la productivité de chaque collaborateur.',
    iconBg: '#FDEBEF',
    icon: (
      <div className="flex gap-[3px]">
        <div className="w-2 h-2 rounded-full bg-[#E8558B]" />
        <div className="w-2 h-2 rounded-full bg-[#E8558B]/50" />
      </div>
    ),
  },
  {
    title: 'Coûts & rentabilité',
    description: 'Calculez le coût réel de chaque tâche et sa marge en un coup d’œil.',
    iconBg: '#EAFBF0',
    icon: <div className="w-4 h-4 bg-[#22C55E] rotate-45" />,
  },
  {
    title: 'Trésorerie',
    description: 'Suivez vos flux de trésorerie et anticipez vos besoins financiers.',
    iconBg: '#E3F7F5',
    icon: <span className="text-turquoise text-[18px] font-extrabold">↑</span>,
  },
  {
    title: 'Facturation',
    description: 'Transformez le temps facturable en factures en quelques clics.',
    iconBg: '#FFF3DE',
    icon: <div className="w-[14px] h-[18px] border-2 border-[#C98A1B] rounded-sm" />,
  },
];

const FLOW_STEPS: { label: string; color: string; shadow: string; shape: React.ReactNode }[] = [
  { label: 'Tâches', color: '#0D1B2A', shadow: 'rgba(13,27,42,0.12)', shape: <div className="w-5 h-5 bg-navy rounded" /> },
  { label: 'Temps', color: '#0D1B2A', shadow: 'rgba(13,27,42,0.12)', shape: <div className="w-5 h-5 rounded-full border-[3px] border-navy" /> },
  { label: 'Coûts', color: '#00857C', shadow: 'rgba(0,179,166,0.15)', shape: <div className="w-5 h-5 bg-turquoise rotate-45" /> },
  {
    label: 'Rentabilité',
    color: '#00857C',
    shadow: 'rgba(0,179,166,0.15)',
    shape: (
      <div className="flex items-end gap-[2px] h-5">
        <div className="w-[5px] h-[40%] bg-turquoise rounded-[1px]" />
        <div className="w-[5px] h-[70%] bg-turquoise rounded-[1px]" />
        <div className="w-[5px] h-full bg-turquoise rounded-[1px]" />
      </div>
    ),
  },
  { label: 'Cash', color: '#22C55E', shadow: 'rgba(34,197,94,0.18)', shape: <span className="text-[#22C55E] text-[22px] font-extrabold">↑</span> },
];

const CheckRow: React.FC<{ text: string; onDark?: boolean }> = ({ text, onDark }) => (
  <div className="flex items-center gap-3">
    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[12px] font-extrabold shrink-0 ${onDark ? 'bg-turquoise text-navy' : 'bg-navy text-white'}`}>✓</span>
    <span className={`text-[14.5px] ${onDark ? 'text-white/85' : 'text-[#3D4655]'}`}>{text}</span>
  </div>
);

interface LandingProps {
  onLogin: () => void;
}

export const Landing: React.FC<LandingProps> = ({ onLogin }) => {
  const [view, setView] = useState<'home' | 'tarifs'>('home');
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  const [modalPlan, setModalPlan] = useState<string | null>(null);

  useEffect(() => {
    if (view === 'home' && pendingAnchor) {
      const id = pendingAnchor;
      setPendingAnchor(null);
      requestAnimationFrame(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
      });
    }
  }, [view, pendingAnchor]);

  const goToAnchor = (id: string) => {
    if (view !== 'home') {
      setPendingAnchor(id);
      setView('home');
    } else {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const goToTarifs = () => {
    setView('tarifs');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goHome = () => {
    setView('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-white font-sans antialiased text-gray-900">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/[0.88] backdrop-blur-[10px] border-b border-[#E6E9EE]">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-10 h-[72px] sm:h-[84px] flex items-center justify-between gap-3 sm:gap-6">
          <button onClick={goHome} className="flex items-center gap-2 shrink-0">
            <Logo size={28} variant="color" />
            {/* The wordmark is dropped on the narrowest phones to buy back the
                width the auth buttons need — the mark alone still identifies it. */}
            <span className="hidden min-[400px]:inline text-[15px] font-extrabold tracking-tight text-navy whitespace-nowrap">
              Tâches <span className="text-turquoise">&amp;</span> Cash
            </span>
          </button>

          <nav className="hidden min-[1041px]:flex items-center gap-7 min-w-0">
            <button onClick={() => goToAnchor('fonctionnalites')} className="text-[14px] font-medium text-[#3D4655] hover:text-navy transition-colors whitespace-nowrap">Fonctionnalités</button>
            <button onClick={() => goToAnchor('dashboard')} className="text-[14px] font-medium text-[#3D4655] hover:text-navy transition-colors whitespace-nowrap">Facturation</button>
            <button onClick={goToTarifs} className={`text-[14px] whitespace-nowrap ${view === 'tarifs' ? 'font-bold text-navy' : 'font-medium text-[#3D4655] hover:text-navy transition-colors'}`}>Tarifs</button>
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-[14px]! font-medium text-[#3D4655]! hover:text-navy! transition-colors whitespace-nowrap">Contact</a>
          </nav>

          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            {/* Always visible: an existing user on a phone has no other way in.
                It used to be hidden below 561px, which locked them out entirely. */}
            <button
              onClick={onLogin}
              className="text-[13px] sm:text-[14px] font-semibold text-navy px-2 whitespace-nowrap"
            >
              Se connecter
            </button>
            {/* Dropped on small screens: it opens the same signup modal as
                "Essai gratuit", just on a different plan, so it's the one of
                the three that costs nothing to lose. */}
            <button
              onClick={() => setModalPlan('Freelance')}
              className="hidden min-[561px]:inline-block px-4 py-2.5 rounded-[10px] text-[14px] font-bold text-navy bg-white border-[1.5px] border-[#E6E9EE] hover:border-navy transition-colors whitespace-nowrap"
            >
              Créer un compte
            </button>
            <button
              onClick={() => setModalPlan('Équipe')}
              className="px-3 sm:px-[18px] py-2.5 sm:py-[11px] rounded-[10px] text-[13px] sm:text-[14px] font-bold text-white bg-navy hover:bg-turquoise transition-colors whitespace-nowrap"
            >
              Essai gratuit
            </button>
          </div>
        </div>
      </header>

      {view === 'home' ? (
        <>
          {/* HERO */}
          <section
            className="relative pt-[88px] px-6 sm:px-10 pb-10 overflow-hidden"
            style={{ background: 'radial-gradient(720px 420px at 78% 20%, rgba(0,179,166,0.10), rgba(0,179,166,0) 70%), linear-gradient(180deg,#FBFCFD 0%, #F2F4F7 100%)' }}
          >
            <div className="max-w-[1280px] mx-auto flex gap-14 items-center flex-wrap">
              {/* Hero copy */}
              <div style={{ flex: '1 1 440px', minWidth: 320, maxWidth: 560 }}>
                <h1 className="mt-[22px] text-[34px] sm:text-[46px] leading-[1.14] font-extrabold text-navy tracking-[-0.02em]">
                  Vos tâches, votre temps, vos coûts. Une seule vision claire de votre rentabilité.
                </h1>
                <p className="mt-[22px] text-[17px] leading-[1.65] text-[#5B6472]">
                  Tâches &amp; Cash connecte le suivi du temps de votre équipe à vos coûts réels et à votre trésorerie — pour des décisions basées sur des chiffres, pas des estimations.
                </p>
                <div className="mt-8 flex gap-3.5 flex-wrap">
                  <button
                    onClick={() => setModalPlan('Équipe')}
                    className="bg-navy text-white px-7 py-4 rounded-xl text-[15px] font-bold shadow-[0_10px_24px_rgba(13,27,42,0.22)] hover:bg-turquoise hover:shadow-[0_10px_24px_rgba(0,179,166,0.3)] transition-colors"
                  >
                    Essai gratuit
                  </button>
                  <button
                    onClick={() => goToAnchor('dashboard')}
                    className="bg-white text-navy px-[26px] py-4 rounded-xl text-[15px] font-semibold border-[1.5px] border-[#E6E9EE] hover:border-navy transition-colors"
                  >
                    Voir Démo
                  </button>
                </div>
              </div>

              {/* Hero dashboard mockup */}
              <div style={{ flex: '1 1 560px', minWidth: 320 }} className="relative h-[560px] flex items-center justify-center">
                <div className="absolute w-[420px] h-[420px] rounded-full blur-[10px] top-10 right-5" style={{ background: 'radial-gradient(circle,rgba(0,179,166,0.22),rgba(0,179,166,0) 70%)' }} />

                {/* Main dashboard card */}
                <div
                  className="relative w-[560px] max-w-full h-[460px] bg-white rounded-[24px] overflow-hidden border border-white/60"
                  style={{
                    boxShadow: '0 40px 70px -24px rgba(13,27,42,0.38), 0 12px 28px rgba(13,27,42,0.10)',
                    transform: 'perspective(1600px) rotateY(-7deg) rotateX(2deg)',
                  }}
                >
                  <div className="flex h-full">
                    <div className="w-[42px] shrink-0 bg-navy flex flex-col items-center pt-2.5 gap-[11px]">
                      <div className="w-[18px] h-[18px] rounded-full bg-white flex items-center justify-center text-navy text-[9px] font-extrabold mb-0.5">✓</div>
                      <div className="w-6 h-5 rounded-[6px] bg-[#1D2939] flex items-center justify-center"><div className="w-[9px] h-[9px] bg-white rounded-[2px]" /></div>
                      <div className="w-3 h-3 rounded-[3px] bg-[#3D4655]" />
                      <div className="w-3 h-3 rounded-full border-2 border-[#3D4655]" />
                      <div className="w-3 h-3 rounded-[3px] bg-[#3D4655]" />
                      <div className="w-3 h-3 rounded-[3px] bg-[#3D4655]" />
                      <div className="w-3 h-3 rounded-[3px] bg-[#3D4655]" />
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col">
                      <div className="h-9 shrink-0 bg-white border-b border-[#E6E9EE] flex items-center justify-between px-3.5">
                        <span className="text-[11px] font-bold text-navy">Tableau de bord</span>
                        <div className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444]" />
                          <div className="w-[18px] h-[18px] rounded-full bg-navy text-white text-[8px] font-extrabold flex items-center justify-center">AD</div>
                        </div>
                      </div>
                      <div className="flex-1 p-3 bg-[#FAFBFC] overflow-hidden">
                        <div className="grid grid-cols-5 gap-1.5">
                          {[
                            { color: '#FFEDD5', label: 'Coût empl.', value: '18 240 DT' },
                            { color: '#DBEAFE', label: 'Effectif', value: '24' },
                            { color: '#EDE9FE', label: 'Tâches', value: '186' },
                            { color: '#D1FAE5', label: 'Clients', value: '32' },
                            { color: '#FCE7F3', label: 'RH en cours', value: '5' },
                          ].map(tile => (
                            <div key={tile.label} className="bg-white border border-[#E6E9EE] rounded-[9px] px-[7px] py-1.5">
                              <div className="w-[15px] h-[15px] rounded-full mb-1" style={{ background: tile.color }} />
                              <div className="text-[6.5px] font-bold text-[#8A93A0] uppercase tracking-[0.03em]">{tile.label}</div>
                              <div className="text-[11px] font-extrabold text-navy mt-0.5">{tile.value}</div>
                            </div>
                          ))}
                        </div>

                        <div className="bg-white border border-[#E6E9EE] rounded-xl p-[11px] mt-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[9.5px] font-bold text-navy">Volume de tâches par collaborateur</span>
                            <div className="flex gap-2">
                              <span className="text-[7px] text-[#8A93A0]"><span className="inline-block w-[5px] h-[5px] rounded-full bg-[#F97316] mr-[3px]" />Terminées</span>
                              <span className="text-[7px] text-[#8A93A0]"><span className="inline-block w-[5px] h-[5px] rounded-full bg-[#3B82F6] mr-[3px]" />Total</span>
                            </div>
                          </div>
                          <div className="flex items-end gap-2 h-14 mt-2">
                            {[[55, 40], [80, 65], [35, 30], [95, 70], [60, 60]].map(([a, b], i) => (
                              <div key={i} className="flex-1 flex gap-0.5 items-end h-full">
                                <div className="flex-1 bg-[#3B82F6] rounded-t-[2px]" style={{ height: `${a}%` }} />
                                <div className="flex-1 bg-[#F97316] rounded-t-[2px]" style={{ height: `${b}%` }} />
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="bg-white border border-[#E6E9EE] rounded-xl p-[11px] mt-2">
                          <div className="text-[9.5px] font-bold text-navy mb-[7px]">Activité par client</div>
                          <div className="grid grid-cols-[1.3fr_0.8fr_0.9fr_1fr] text-[6.5px] font-bold text-[#8A93A0] uppercase tracking-[0.03em] pb-1 border-b border-[#EEF1F4]">
                            <span>Client</span><span>Tâches</span><span>Durée</span><span>Coût</span>
                          </div>
                          <div className="grid grid-cols-[1.3fr_0.8fr_0.9fr_1fr] text-[9px] text-[#3D4655] font-semibold py-1.5 border-b border-[#EEF1F4]">
                            <span>Client A</span><span>10</span><span>3h20</span><span className="text-[#22C55E] font-bold">1 240 DT</span>
                          </div>
                          <div className="grid grid-cols-[1.3fr_0.8fr_0.9fr_1fr] text-[9px] text-[#3D4655] font-semibold py-1.5">
                            <span>Client B</span><span>6</span><span>1h05</span><span className="text-[#22C55E] font-bold">640 DT</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Floating cards */}
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute top-[-6px] left-[-30px] w-[172px] bg-white rounded-2xl p-3.5 animate-[landingFloatA_6s_ease-in-out_infinite]" style={{ boxShadow: '0 18px 34px -12px rgba(13,27,42,0.28)' }}>
                    <div className="flex items-center gap-2.5">
                      <div className="w-[34px] h-[34px] rounded-[10px] bg-[#E3F7F5] flex items-center justify-center shrink-0">
                        <div className="w-3.5 h-3.5 rounded-full border-2 border-turquoise relative">
                          <div className="absolute w-[5px] h-[1.5px] bg-turquoise top-[6px] left-[7px] rotate-[35deg]" />
                        </div>
                      </div>
                      <div>
                        <div className="text-[15px] font-extrabold text-navy leading-[1.1]">08h 42m</div>
                        <div className="text-[10px] text-[#8A93A0] mt-0.5">Temps travaillé</div>
                      </div>
                    </div>
                  </div>

                  <div className="absolute bottom-9 left-[-56px] w-[180px] bg-white rounded-2xl p-3.5 animate-[landingFloatB_7s_ease-in-out_infinite]" style={{ boxShadow: '0 18px 34px -12px rgba(13,27,42,0.28)' }}>
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-bold text-navy">Audit client</span>
                      <span className="text-[9px] font-bold text-[#00857C] bg-[#E3F7F5] px-[7px] py-[3px] rounded-full">En cours</span>
                    </div>
                    <div className="mt-2.5 h-[5px] rounded-[3px] bg-[#EEF1F4]"><div className="w-[72%] h-[5px] rounded-[3px] bg-[#22C55E]" /></div>
                    <div className="text-[10px] font-bold text-[#8A93A0] mt-1.5 text-right">72%</div>
                  </div>

                  <div className="absolute top-16 right-[-46px] w-[150px] bg-white rounded-2xl p-3.5 animate-[landingFloatC_6.5s_ease-in-out_infinite]" style={{ boxShadow: '0 18px 34px -12px rgba(13,27,42,0.28)' }}>
                    <div className="text-[10px] text-[#8A93A0] uppercase tracking-[0.04em] font-bold">Équipe</div>
                    <div className="text-[20px] font-extrabold text-navy mt-0.5">84%</div>
                    <div className="flex items-end gap-1 mt-2 h-6">
                      <div className="w-2 h-[40%] bg-[#CFEDEA] rounded-[2px]" />
                      <div className="w-2 h-[70%] bg-[#5FCBC0] rounded-[2px]" />
                      <div className="w-2 h-[55%] bg-turquoise rounded-[2px]" />
                      <div className="w-2 h-[90%] bg-navy rounded-[2px]" />
                    </div>
                  </div>

                  <div className="absolute bottom-[-16px] right-2 w-[186px] bg-white rounded-2xl p-3.5 animate-[landingFloatD_7.5s_ease-in-out_infinite]" style={{ boxShadow: '0 18px 34px -12px rgba(13,27,42,0.28)' }}>
                    <div className="flex items-center gap-2.5">
                      <div className="w-[34px] h-[34px] rounded-[10px] bg-[#EAFBF0] flex items-center justify-center shrink-0 text-[#22C55E] text-[16px] font-extrabold">↑</div>
                      <div>
                        <div className="text-[15px] font-extrabold text-[#22C55E] leading-[1.1]">+12 450 DT</div>
                        <div className="text-[10px] text-[#8A93A0] mt-0.5">Flux de trésorerie</div>
                      </div>
                    </div>
                  </div>

                  <div className="absolute top-[-24px] right-24 w-[200px] bg-white rounded-2xl px-3.5 py-3 opacity-[0.96] animate-[landingFloatE_8s_ease-in-out_infinite]" style={{ boxShadow: '0 18px 34px -12px rgba(13,27,42,0.24)' }}>
                    <div className="flex items-center gap-2">
                      <span className="w-[7px] h-[7px] rounded-full bg-[#22C55E] shrink-0 animate-[landingPulseDot_2s_ease-in-out_infinite]" />
                      <span className="text-[11.5px] font-bold text-navy">Nouvelle tâche assignée</span>
                    </div>
                    <div className="text-[10.5px] text-[#8A93A0] mt-[3px] ml-[15px]">Audit dossier client</div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* FLOW SECTION */}
          <section className="py-24 px-6 sm:px-10 bg-white">
            <div className="max-w-[980px] mx-auto text-center">
              <h2 className="text-[26px] sm:text-[32px] font-extrabold text-navy tracking-[-0.01em]">Une chaîne de valeur, entièrement connectée</h2>
              <p className="mt-4 max-w-[560px] mx-auto text-[15.5px] leading-[1.6] text-[#5B6472]">De la tâche à la trésorerie, chaque minute travaillée devient une donnée financière exploitable.</p>

              <div className="relative mt-16 flex justify-between items-start">
                <div className="absolute top-[31px] left-10 right-10 h-0.5 z-0" style={{ background: 'linear-gradient(90deg,#0D1B2A,#00B3A6,#22C55E)' }} />
                {FLOW_STEPS.map(step => (
                  <div key={step.label} className="relative z-10 flex-1 flex flex-col items-center gap-3.5">
                    <div
                      className="w-16 h-16 rounded-full bg-white flex items-center justify-center"
                      style={{ border: `2px solid ${step.color}`, boxShadow: `0 6px 16px ${step.shadow}` }}
                    >
                      {step.shape}
                    </div>
                    <span className="text-[13px] sm:text-[14px] font-bold" style={{ color: step.color }}>{step.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* FEATURES */}
          <section id="fonctionnalites" className="py-24 px-6 sm:px-10 bg-[#F2F4F7]">
            <div className="max-w-[1200px] mx-auto">
              <div className="text-center max-w-[600px] mx-auto">
                <div className="inline-flex px-3.5 py-1.5 bg-white border border-[#E6E9EE] rounded-full text-[12px] font-bold tracking-[0.06em] uppercase text-[#00857C]">Fonctionnalités</div>
                <h2 className="mt-[18px] text-[26px] sm:text-[32px] font-extrabold text-navy tracking-[-0.01em]">Tout ce qu'il faut pour piloter votre activité</h2>
              </div>

              <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[22px]">
                {HOME_FEATURES.map(f => (
                  <div key={f.title} className="bg-white rounded-[18px] border border-[#E6E9EE] p-7 hover:-translate-y-1 hover:shadow-[0_16px_32px_rgba(13,27,42,0.08)] transition-all">
                    <div className="w-[46px] h-[46px] rounded-xl flex items-center justify-center" style={{ background: f.iconBg }}>{f.icon}</div>
                    <div className="text-[16px] font-bold text-navy mt-4">{f.title}</div>
                    <p className="text-[14px] leading-[1.55] text-[#5B6472] mt-2">{f.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* TIME TRACKING SHOWCASE */}
          <section className="py-24 sm:py-[104px] px-6 sm:px-10 bg-white">
            <div className="max-w-[1200px] mx-auto flex gap-16 items-center flex-wrap-reverse">
              <div style={{ flex: '1 1 420px', minWidth: 300 }} className="bg-[#F2F4F7] rounded-[20px] p-[22px]" >
                <div style={{ boxShadow: '0 30px 60px -20px rgba(13,27,42,0.18)' }} className="rounded-[20px]">
                  <div className="text-[11px] font-bold text-[#8A93A0] uppercase tracking-[0.05em] mb-2.5">Activités en pause</div>
                  <div className="bg-white border border-[#E6E9EE] rounded-xl overflow-hidden mb-3.5">
                    {[
                      { title: 'Mission de conseil', sub: 'Client X · Audit', duration: '0h 24m' },
                      { title: 'Révision comptable', sub: 'Client Y · Clôture', duration: '1h 05m' },
                    ].map((row, i) => (
                      <div key={row.title} className={`flex items-center justify-between px-3.5 py-[11px] ${i === 0 ? 'border-b border-[#F2F4F7]' : ''}`}>
                        <div>
                          <div className="text-[11.5px] font-bold text-navy">{row.title}</div>
                          <div className="text-[9.5px] text-[#8A93A0] mt-0.5">{row.sub}</div>
                        </div>
                        <div className="flex items-center gap-2.5">
                          <span className="text-[10.5px] font-bold text-[#3D4655]">{row.duration}</span>
                          <div className="w-[22px] h-[22px] rounded-full bg-[#FDBA74] flex items-center justify-center">
                            <div className="w-0 h-0 border-t-4 border-b-4 border-t-transparent border-b-transparent border-l-[6px] border-l-white ml-0.5" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="bg-navy rounded-2xl p-4">
                    <div className="flex items-center gap-[7px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#F97316] animate-[landingPulseDot_2s_ease-in-out_infinite]" />
                      <span className="text-[9px] font-bold text-white/60 uppercase tracking-[0.05em]">Chronomètre actif</span>
                    </div>
                    <div className="text-[11px] font-bold text-white mt-2">Client Z</div>
                    <div className="text-[26px] font-extrabold text-white mt-0.5 tabular-nums">00:08:42</div>
                    <div className="flex gap-2 mt-3">
                      <div className="flex-1 text-center bg-[#1D2939] text-white py-2 rounded-lg text-[10.5px] font-bold">Pause</div>
                      <div className="flex-1 text-center bg-[#EF4444] text-white py-2 rounded-lg text-[10.5px] font-bold">Arrêter</div>
                    </div>
                  </div>

                  <div className="mt-3.5 bg-white border border-[#E6E9EE] rounded-xl overflow-hidden">
                    <div className="grid grid-cols-[1.3fr_1fr_0.8fr] px-3 py-2 bg-[#F2F4F7] text-[8px] font-bold text-[#8A93A0] uppercase tracking-[0.04em]">
                      <span>Collaborateur</span><span>Durée</span><span>Statut</span>
                    </div>
                    <div className="grid grid-cols-[1.3fr_1fr_0.8fr] items-center px-3 py-2.5 text-[10.5px] text-[#3D4655] font-semibold border-t border-[#F2F4F7]">
                      <span>Collaborateur 1</span><span>2h 10m</span><span className="text-[#22C55E] font-bold">Terminé</span>
                    </div>
                    <div className="grid grid-cols-[1.3fr_1fr_0.8fr] items-center px-3 py-2.5 text-[10.5px] text-[#3D4655] font-semibold border-t border-[#F2F4F7]">
                      <span>Collaborateur 2</span><span>0h 45m</span><span className="text-[#F97316] font-bold">En pause</span>
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ flex: '1 1 420px', minWidth: 300 }}>
                <div className="inline-flex px-3.5 py-1.5 bg-[#E3F7F5] rounded-full text-[12px] font-bold tracking-[0.06em] uppercase text-[#00857C]">Suivi du temps</div>
                <h2 className="mt-[18px] text-[26px] sm:text-[32px] font-extrabold tracking-[-0.01em] leading-[1.2] text-navy">Le temps de votre équipe, suivi en direct, jusqu'à la dernière seconde</h2>
                <p className="mt-[18px] text-[15.5px] leading-[1.65] text-[#5B6472] max-w-[460px]">Un chronomètre par collaborateur, une vue consolidée pour vous : démarrez, mettez en pause ou basculez de mission en un clic.</p>
                <div className="mt-7 flex flex-col gap-3.5">
                  <CheckRow text="Chronométrage en un clic, avec reprise instantanée des tâches en pause" />
                  <CheckRow text="Historique complet par collaborateur, client et mission" />
                  <CheckRow text="Distinction claire entre temps facturable et non facturable" />
                  <CheckRow text="Coût calculé automatiquement dès l'arrêt du chronomètre" />
                </div>
                <button
                  onClick={() => setModalPlan('Équipe')}
                  className="inline-block mt-8 bg-navy text-white px-[26px] py-[15px] rounded-xl text-[15px] font-bold hover:bg-turquoise transition-colors"
                >
                  Essayer le suivi du temps
                </button>
              </div>
            </div>
          </section>

          {/* FACTURATION SHOWCASE */}
          <section id="dashboard" className="py-24 sm:py-[104px] px-6 sm:px-10 bg-navy text-white">
            <div className="max-w-[1200px] mx-auto flex gap-16 items-center flex-wrap">
              <div style={{ flex: '1 1 420px', minWidth: 300 }}>
                <div className="inline-flex px-3.5 py-1.5 bg-white/[0.08] rounded-full text-[12px] font-bold tracking-[0.06em] uppercase text-[#5FCBC0]">Facturation</div>
                <h2 className="mt-[18px] text-[26px] sm:text-[32px] font-extrabold tracking-[-0.01em] leading-[1.2]">Votre temps facturable transformé en factures, en quelques clics</h2>
                <p className="mt-[18px] text-[15.5px] leading-[1.65] text-white/65 max-w-[460px]">Générez des factures conformes directement depuis le temps suivi et les missions clôturées — sans ressaisie.</p>
                <div className="mt-7 flex flex-col gap-3.5">
                  <CheckRow onDark text="Facture générée automatiquement depuis le temps facturable" />
                  <CheckRow onDark text="Calcul automatique de la TVA, la retenue à la source et le timbre fiscal" />
                  <CheckRow onDark text="Export PDF et suivi des encaissements en un clic" />
                  <CheckRow onDark text="Chaque facture rattachée à sa mission et son flux de trésorerie" />
                </div>
                <button
                  onClick={() => setModalPlan('Équipe')}
                  className="inline-block mt-8 bg-turquoise text-navy px-[26px] py-[15px] rounded-xl text-[15px] font-bold hover:bg-white transition-colors"
                >
                  Créer une facture
                </button>
              </div>

              <div style={{ flex: '1 1 420px', minWidth: 300 }} className="bg-white rounded-2xl p-6 text-navy">
                <div className="flex items-start justify-between">
                  <div className="w-11 h-[34px] border-[1.5px] border-dashed border-[#E6E9EE] rounded-md flex items-center justify-center text-[7px] text-[#B7BFC9] text-center leading-tight">Logo</div>
                  <div className="text-right">
                    <div className="text-[18px] font-extrabold text-navy">Facture</div>
                    <div className="text-[10px] text-[#8A93A0] mt-0.5">N° 0007</div>
                  </div>
                </div>
                <div className="flex gap-5 mt-4">
                  <div className="flex-1">
                    <div className="text-[8px] font-bold text-[#8A93A0] uppercase tracking-[0.05em]">Détails du client</div>
                    <div className="mt-1.5 h-[9px] w-[70%] bg-[#EEF1F4] rounded-[3px]" />
                    <div className="mt-1 h-[9px] w-1/2 bg-[#EEF1F4] rounded-[3px]" />
                  </div>
                  <div className="flex-1">
                    <div className="text-[8px] font-bold text-[#8A93A0] uppercase tracking-[0.05em]">Date de création</div>
                    <div className="mt-1.5 text-[11px] font-semibold text-[#3D4655]">22/08/2026</div>
                  </div>
                </div>
                <div className="mt-4 border border-[#E6E9EE] rounded-[10px] overflow-hidden">
                  <div className="grid grid-cols-[2fr_0.7fr_1fr] px-3 py-2 bg-[#F2F4F7] text-[8px] font-bold text-[#8A93A0] uppercase tracking-[0.04em]">
                    <span>Désignation</span><span>TVA</span><span>Montant HT</span>
                  </div>
                  <div className="grid grid-cols-[2fr_0.7fr_1fr] px-3 py-2.5 text-[10.5px] text-[#3D4655] font-semibold border-t border-[#F2F4F7]">
                    <span>Mission de conseil — Août 2026</span><span>19%</span><span>2 400 DT</span>
                  </div>
                </div>
                <div className="mt-3.5 flex flex-col gap-1.5">
                  <div className="flex justify-between text-[10.5px] text-[#5B6472]"><span>Total HT</span><span>2 400 DT</span></div>
                  <div className="flex justify-between text-[10.5px] text-[#5B6472]"><span>Total TVA</span><span>456 DT</span></div>
                  <div className="flex justify-between text-[10.5px] font-bold text-navy"><span>Total TTC</span><span>2 856 DT</span></div>
                  <div className="flex justify-between text-[10px] text-[#8A93A0]"><span>Retenue à la source — 1%</span><span>− 24 DT</span></div>
                  <div className="flex justify-between bg-navy text-white px-3 py-2.5 rounded-lg mt-1.5 text-[11px] font-bold"><span>Net à payer</span><span>2 832 DT</span></div>
                </div>
              </div>
            </div>
          </section>
        </>
      ) : (
        <>
          {/* PRICING HERO */}
          <section className="pt-[88px] px-6 sm:px-10 pb-10 bg-[linear-gradient(180deg,#FBFCFD_0%,#F2F4F7_100%)]">
            <div className="max-w-[760px] mx-auto text-center">
              <h1 className="mt-[22px] text-[34px] sm:text-[42px] font-extrabold text-navy tracking-[-0.02em] leading-[1.15]">
                Un prix simple, qui grandit avec votre équipe
              </h1>
              <p className="mt-[18px] text-[16.5px] text-[#5B6472] leading-[1.6]">
                Toutes les offres donnent accès à l'intégralité des vues et fonctionnalités — tâches, temps, coûts, facturation et trésorerie.
              </p>
            </div>
          </section>

          {/* PRICING CARDS */}
          <section className="pt-6 px-6 sm:px-10 pb-[100px] bg-[#F2F4F7]">
            <div className="max-w-[1080px] mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
              {PLANS.map(plan => (
                <div
                  key={plan.name}
                  className={`relative rounded-[20px] px-[30px] py-9 text-left flex flex-col ${
                    plan.highlighted
                      ? 'bg-navy shadow-[0_30px_60px_-20px_rgba(13,27,42,0.4)]'
                      : 'bg-white border border-[#E6E9EE]'
                  }`}
                >
                  {plan.highlighted && (
                    <span className="absolute -top-[13px] left-1/2 -translate-x-1/2 bg-turquoise text-navy text-[11px] font-extrabold px-[14px] py-[5px] rounded-full tracking-[0.03em] whitespace-nowrap">
                      Le plus populaire
                    </span>
                  )}
                  <h3 className={`text-[15px] font-bold ${plan.highlighted ? 'text-white' : 'text-navy'}`}>{plan.name}</h3>
                  <p className={`text-[13.5px] mt-1.5 ${plan.highlighted ? 'text-white/55' : 'text-[#8A93A0]'}`}>{plan.tagline}</p>

                  <div className="mt-6 flex items-baseline gap-1.5">
                    <span className={`text-[40px] font-extrabold ${plan.highlighted ? 'text-white' : 'text-navy'}`}>{plan.price}</span>
                    {plan.period && <span className={`text-[14px] ${plan.highlighted ? 'text-white/55' : 'text-[#8A93A0]'}`}>{plan.period}</span>}
                  </div>
                  <p className={`text-[13px] mt-1 ${plan.highlighted ? 'text-white/55' : 'text-[#8A93A0]'}`}>{plan.seats}</p>

                  <div className={`h-px my-6 ${plan.highlighted ? 'bg-white/[0.12]' : 'bg-[#EEF1F4]'}`} />

                  <div className="flex flex-col gap-3 flex-1">
                    {plan.features.map(f => (
                      <div key={f} className="flex items-center gap-2.5">
                        <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-extrabold shrink-0 ${
                          plan.highlighted ? 'bg-turquoise text-navy' : 'bg-[#E3F7F5] text-[#00857C]'
                        }`}>✓</span>
                        <span className={`text-[13.5px] leading-snug ${plan.highlighted ? 'text-white/85' : 'text-[#3D4655]'}`}>{f}</span>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => setModalPlan(plan.name)}
                    className={`mt-7 w-full py-[14px] px-6 rounded-xl text-[14.5px] font-bold transition-colors ${
                      plan.highlighted
                        ? 'bg-turquoise text-navy hover:bg-white'
                        : 'bg-white text-navy border-[1.5px] border-[#E6E9EE] hover:border-navy'
                    }`}
                  >
                    {plan.cta}
                  </button>
                </div>
              ))}
            </div>

            <p className="mt-9 text-center text-[13.5px] text-[#8A93A0]">
              Besoin de plus de 10 utilisateurs ?{' '}
              <button onClick={() => setModalPlan('Sur mesure')} className="text-turquoise font-semibold hover:underline">
                Contactez-nous
              </button>{' '}
              pour une offre sur mesure.
            </p>
          </section>
        </>
      )}

      {/* CTA banner */}
      <section className="py-24 px-6 sm:px-10 bg-white">
        <div className="max-w-[920px] mx-auto bg-navy rounded-[28px] px-8 sm:px-12 py-16 text-center relative overflow-hidden">
          <div className="absolute w-[360px] h-[360px] rounded-full bg-[radial-gradient(circle,rgba(0,179,166,0.28),rgba(0,179,166,0)_70%)] -top-[140px] -right-20" />
          <div className="relative">
            <h2 className="text-[26px] sm:text-[30px] font-extrabold text-white tracking-[-0.01em] max-w-[600px] mx-auto leading-[1.25]">
              Prêt à voir où va vraiment votre temps et votre argent ?
            </h2>
            <p className="mt-4 text-[15.5px] text-white/65 max-w-[480px] mx-auto">
              {view === 'home'
                ? 'Rejoignez les équipes qui pilotent leur rentabilité avec Tâches & Cash.'
                : "Créez votre compte en quelques minutes, aucune carte bancaire requise pour l'offre Freelance."}
            </p>
            <button
              onClick={() => setModalPlan('Freelance')}
              className="mt-7 inline-block px-[30px] py-4 rounded-xl text-[15px] font-bold text-navy bg-turquoise hover:bg-white transition-colors"
            >
              {view === 'home' ? 'Démarrer maintenant' : 'Créer un compte'}
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-navy px-6 sm:px-10 pt-14 pb-7">
        <div className="max-w-[1280px] mx-auto flex flex-col sm:flex-row justify-between gap-12 flex-wrap">
          <div className="max-w-[280px]">
            <button onClick={goHome} className="flex items-center gap-2">
              <Logo size={24} variant="white" />
              <span className="text-[14px] font-extrabold text-white">
                Tâches <span className="text-turquoise">&amp;</span> Cash
              </span>
            </button>
            <p className="mt-3.5 text-[12px] font-semibold tracking-[0.06em] text-white/40 uppercase">
              Time tracking • Invoicing • Growth
            </p>
          </div>
          <div className="flex gap-16 flex-wrap">
            <div>
              <p className="text-[12px] font-bold text-white uppercase tracking-[0.05em] mb-3.5">Produit</p>
              <div className="flex flex-col gap-2.5">
                <button onClick={() => goToAnchor('fonctionnalites')} className="text-left text-[13.5px] text-white/60 hover:text-white transition-colors">Fonctionnalités</button>
                <button onClick={goToTarifs} className="text-left text-[13.5px] text-white/60 hover:text-white transition-colors">Tarifs</button>
              </div>
            </div>
            <div>
              <p className="text-[12px] font-bold text-white uppercase tracking-[0.05em] mb-3.5">Entreprise</p>
              <div className="flex flex-col gap-2.5">
                <a href={`mailto:${CONTACT_EMAIL}`} className="flex items-center gap-1.5 text-[13.5px] text-white/60! hover:text-white! transition-colors">
                  <Mail className="w-3.5 h-3.5" /> Contact
                </a>
              </div>
            </div>
          </div>
        </div>
        <div className="max-w-[1280px] mx-auto mt-10 pt-6 border-t border-white/10">
          <p className="text-[12.5px] text-white/40">© {new Date().getFullYear()} Tâches &amp; Cash. Tous droits réservés.</p>
        </div>
      </footer>

      {modalPlan && <RequestAccessModal plan={modalPlan} onClose={() => setModalPlan(null)} />}
    </div>
  );
};
