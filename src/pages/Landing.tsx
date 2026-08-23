import React, { useState } from 'react';
import { Clock, Receipt, FileCheck2, Users2, Check, Mail } from 'lucide-react';
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

const FEATURES = [
  {
    icon: Clock,
    title: 'Pointage en temps réel',
    description: "Suivi du temps et des tâches par client et par mission, avec coût employeur calculé automatiquement.",
  },
  {
    icon: Receipt,
    title: 'Facturation & trésorerie',
    description: 'Factures légales numérotées, devis, et suivi de trésorerie conformes aux usages tunisiens.',
  },
  {
    icon: FileCheck2,
    title: 'Ressources métier',
    description: 'Documents des modèles, liens utiles et suivi des échéances réglementaires par client.',
  },
  {
    icon: Users2,
    title: 'Gestion RH',
    description: "Congés, autorisations d'absence et soldes gérés en un seul endroit.",
  },
];

interface LandingProps {
  onLogin: () => void;
}

export const Landing: React.FC<LandingProps> = ({ onLogin }) => {
  const [modalPlan, setModalPlan] = useState<string | null>(null);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-white font-sans antialiased text-gray-900">
      {/* Header */}
      <header className="border-b border-gray-100 sticky top-0 bg-white/95 backdrop-blur-sm z-40">
        <div className="max-w-7xl mx-auto px-6 h-[68px] flex items-center justify-between gap-6">
          <div className="flex items-center gap-2 shrink-0">
            <Logo size={28} variant="color" />
            <span className="text-[15px] font-extrabold tracking-tight text-navy">
              Tâches <span className="text-turquoise">&amp;</span> Cash
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-7 text-[13.5px] font-medium text-gray-600">
            <button onClick={() => scrollTo('fonctionnalites')} className="hover:text-navy transition-colors">Fonctionnalités</button>
            <button onClick={() => scrollTo('fonctionnalites')} className="hover:text-navy transition-colors">Facturation</button>
            <button onClick={() => scrollTo('tarifs')} className="hover:text-navy transition-colors font-semibold text-navy">Tarifs</button>
            <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-navy transition-colors">Contact</a>
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={onLogin}
              className="text-[13.5px] font-semibold text-gray-700 hover:text-navy px-2 transition-colors"
            >
              Se connecter
            </button>
            <button
              onClick={() => setModalPlan('Freelance')}
              className="px-4 py-2 rounded-lg text-[13.5px] font-bold text-navy border border-gray-200 hover:bg-gray-50 transition-colors whitespace-nowrap"
            >
              Créer un compte
            </button>
            <button
              onClick={() => setModalPlan('Équipe')}
              className="px-4 py-2.5 rounded-lg text-[13.5px] font-bold text-white bg-navy hover:bg-navy-hover transition-colors whitespace-nowrap"
            >
              Essai gratuit
            </button>
          </div>
        </div>
      </header>

      {/* Pricing / hero */}
      <section id="tarifs" className="bg-canvas py-20 px-6">
        <div className="max-w-5xl mx-auto text-center">
          <h1 className="text-[34px] sm:text-[42px] font-extrabold text-navy tracking-tight leading-[1.15]">
            Un prix simple, qui grandit avec votre équipe
          </h1>
          <p className="mt-4 text-[15px] text-gray-600 max-w-2xl mx-auto leading-relaxed">
            Toutes les offres donnent accès à l'intégralité des vues et fonctionnalités — tâches, temps, coûts, facturation et trésorerie.
          </p>

          <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
            {PLANS.map(plan => (
              <div
                key={plan.name}
                className={`relative rounded-2xl p-7 text-left flex flex-col ${
                  plan.highlighted
                    ? 'bg-navy text-white shadow-2xl md:-mt-4 md:mb-[-16px]'
                    : 'bg-white border border-gray-200 shadow-sm'
                }`}
              >
                {plan.highlighted && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-turquoise text-navy text-[11px] font-bold px-3 py-1 rounded-full whitespace-nowrap">
                    Le plus populaire
                  </span>
                )}
                <h3 className={`text-[16px] font-bold ${plan.highlighted ? 'text-white' : 'text-navy'}`}>{plan.name}</h3>
                <p className={`text-[13px] mt-0.5 ${plan.highlighted ? 'text-white/70' : 'text-gray-500'}`}>{plan.tagline}</p>

                <div className="mt-5 flex items-baseline gap-1">
                  <span className={`text-[32px] font-extrabold ${plan.highlighted ? 'text-white' : 'text-navy'}`}>{plan.price}</span>
                  {plan.period && <span className={`text-[13px] ${plan.highlighted ? 'text-white/70' : 'text-gray-500'}`}>{plan.period}</span>}
                </div>
                <p className={`text-[12.5px] mt-1 ${plan.highlighted ? 'text-white/70' : 'text-gray-500'}`}>{plan.seats}</p>

                <div className={`mt-5 pt-5 border-t space-y-2.5 flex-1 ${plan.highlighted ? 'border-white/15' : 'border-gray-100'}`}>
                  {plan.features.map(f => (
                    <div key={f} className="flex items-start gap-2">
                      <Check className={`w-4 h-4 mt-0.5 shrink-0 ${plan.highlighted ? 'text-turquoise' : 'text-turquoise'}`} />
                      <span className={`text-[13px] leading-snug ${plan.highlighted ? 'text-white/90' : 'text-gray-700'}`}>{f}</span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => setModalPlan(plan.name)}
                  className={`mt-6 w-full py-3 rounded-xl text-[13.5px] font-bold transition-colors ${
                    plan.highlighted
                      ? 'bg-turquoise text-navy hover:brightness-95'
                      : 'bg-white text-navy border border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {plan.cta}
                </button>
              </div>
            ))}
          </div>

          <p className="mt-10 text-[13.5px] text-gray-500">
            Besoin de plus de 10 utilisateurs ?{' '}
            <button onClick={() => setModalPlan('Sur mesure')} className="text-turquoise font-semibold hover:underline">
              Contactez-nous
            </button>{' '}
            pour une offre sur mesure.
          </p>
        </div>
      </section>

      {/* Features */}
      <section id="fonctionnalites" className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-[26px] font-extrabold text-navy text-center tracking-tight">
            Tout ce qu'il faut pour piloter votre cabinet
          </h2>
          <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 gap-6">
            {FEATURES.map(({ icon: Icon, title, description }) => (
              <div key={title} className="flex gap-4 p-5 rounded-xl border border-gray-100 hover:border-gray-200 transition-colors">
                <div className="w-11 h-11 rounded-lg bg-canvas flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-navy" />
                </div>
                <div>
                  <h3 className="text-[14.5px] font-bold text-navy">{title}</h3>
                  <p className="text-[13px] text-gray-600 mt-1 leading-relaxed">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA banner */}
      <section className="px-6 pb-20">
        <div className="max-w-5xl mx-auto bg-navy rounded-3xl px-8 py-16 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(0,179,166,0.25),transparent_60%)]" />
          <div className="relative">
            <h2 className="text-[26px] sm:text-[30px] font-extrabold text-white tracking-tight max-w-xl mx-auto leading-[1.25]">
              Prêt à voir où va vraiment votre temps et votre argent ?
            </h2>
            <p className="mt-3 text-[14px] text-white/70 max-w-md mx-auto">
              Créez votre compte en quelques minutes, aucune carte bancaire requise pour l'offre Freelance.
            </p>
            <button
              onClick={() => setModalPlan('Freelance')}
              className="mt-7 px-7 py-3.5 rounded-xl text-[14px] font-bold text-navy bg-turquoise hover:brightness-95 transition-all"
            >
              Créer un compte
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-navy px-6 py-12">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row justify-between gap-10">
          <div>
            <div className="flex items-center gap-2">
              <Logo size={24} variant="white" />
              <span className="text-[14px] font-extrabold text-white">
                Tâches <span className="text-turquoise">&amp;</span> Cash
              </span>
            </div>
            <p className="mt-2 text-[11px] font-semibold tracking-wider text-white/40 uppercase">
              Time tracking • Invoicing • Growth
            </p>
          </div>
          <div className="flex gap-16">
            <div>
              <p className="text-[11px] font-bold text-white/50 uppercase tracking-wider mb-3">Produit</p>
              <div className="space-y-2">
                <button onClick={() => scrollTo('fonctionnalites')} className="block text-[13px] text-white/70 hover:text-white transition-colors">Fonctionnalités</button>
                <button onClick={() => scrollTo('tarifs')} className="block text-[13px] text-white/70 hover:text-white transition-colors">Tarifs</button>
              </div>
            </div>
            <div>
              <p className="text-[11px] font-bold text-white/50 uppercase tracking-wider mb-3">Entreprise</p>
              <a href={`mailto:${CONTACT_EMAIL}`} className="flex items-center gap-1.5 text-[13px] text-white/70 hover:text-white transition-colors">
                <Mail className="w-3.5 h-3.5" /> Contact
              </a>
            </div>
          </div>
        </div>
        <div className="max-w-5xl mx-auto mt-10 pt-6 border-t border-white/10">
          <p className="text-[12px] text-white/40">© {new Date().getFullYear()} Tâches &amp; Cash. Tous droits réservés.</p>
        </div>
      </footer>

      {modalPlan && <RequestAccessModal plan={modalPlan} onClose={() => setModalPlan(null)} />}
    </div>
  );
};
