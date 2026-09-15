import React, { useState, useEffect } from 'react';
import {
  Mail, LayoutDashboard, Timer, ListChecks, Building2, FileText, Wallet,
  CalendarCheck, FolderKanban, Users, MessageSquare, Globe, Gift, ArrowRight,
  Compass, Clock, AlertTriangle, ArrowDown,
} from 'lucide-react';
import { Logo } from '../components/Logo';
import { RequestAccessModal } from '../components/landing/RequestAccessModal';
import { Reveal, CountUp } from '../components/landing/Reveal';
import { ModuleExplorer } from '../components/landing/ModuleExplorer';
import { ClientLogos } from '../components/landing/ClientLogos';
import { AnimatedLogo } from '../components/landing/AnimatedLogo';
import { SELLABLE_PLANS, planMeta, planPriceForSeats, planListPriceForSeats, formatDT, FREELANCER_UPGRADE_PRICE_DT } from '../constants/plans';

const CONTACT_EMAIL = 'contact@taches-and-cash.com';

/**
 * Le plafond du curseur « utilisateurs » sur une carte — purement une limite
 * d'affichage, pas une limite commerciale : au-delà, la carte propose déjà
 * l'offre sur mesure en pied de section. `clampSeatsForPlan` côté serveur
 * borne bien plus haut (`MAX_DYNAMIC_SEATS`, garde-fou anti-abus).
 */
const SEAT_STEPPER_MAX = 50;

interface PricingPlan {
  id: string;
  name: string;
  tagline: string;
  isFree: boolean;
  /** A un tarif par utilisateur supplémentaire — affiche le curseur. */
  dynamic: boolean;
  baseSeats: number;
  seats: string;
  portalSeats: string;
  features: string[];
  cta: string;
  highlighted?: boolean;
  tone: Tone;
  /** Remise de lancement en %, si l'offre en porte une — voir plans.ts. */
  launchDiscountPercent?: number;
}

/**
 * Trois traitements, pas deux, parce qu'il y a deux axes différents à dire :
 * `navy` met une offre **en avant** parmi ses pareilles (le pack le plus
 * populaire), `accent` dit qu'une offre **n'est pas de la même famille** —
 * l'offre Facturation ne se compare pas aux packs, qui sont le même produit
 * à trois tailles d'équipe. Quatre cartes identiques feraient lire « 30 DT »
 * comme le pack le moins cher.
 */
type Tone = 'navy' | 'accent' | 'plain';

const TONES: Record<Tone, {
  card: string; title: string; muted: string; portal: string;
  rule: string; bullet: string; feature: string; cta: string;
}> = {
  navy: {
    card: 'bg-navy shadow-[0_30px_60px_-20px_rgba(13,27,42,0.4)]',
    title: 'text-white', muted: 'text-white/55', portal: 'text-turquoise',
    rule: 'bg-white/[0.12]', bullet: 'bg-turquoise text-navy', feature: 'text-white/85',
    cta: 'bg-turquoise text-navy hover:bg-white',
  },
  // Le fond turquoise clair de la charte. Les encres sont assombries pour
  // tenir sur lui : le gris `#8A93A0` des cartes blanches y tombe à 2,6:1.
  accent: {
    card: 'bg-[#E3F7F5] border border-[#7FD8CF]',
    title: 'text-navy', muted: 'text-[#3D6560]', portal: 'text-[#00655E]',
    rule: 'bg-[#B6E7E1]', bullet: 'bg-turquoise text-navy', feature: 'text-[#22453F]',
    cta: 'bg-navy text-white hover:bg-navy-hover',
  },
  plain: {
    card: 'bg-white border border-[#E6E9EE]',
    title: 'text-navy', muted: 'text-[#8A93A0]', portal: 'text-[#00857C]',
    rule: 'bg-[#EEF1F4]', bullet: 'bg-[#E3F7F5] text-[#00857C]', feature: 'text-[#3D4655]',
    cta: 'bg-white text-navy border-[1.5px] border-[#E6E9EE] hover:border-navy',
  },
};

/**
 * Les cartes de tarifs sont dérivées de [plans.ts](../constants/plans.ts), la
 * même liste que lit le serveur : un prix corrigé ici et pas là-bas produirait
 * une page publique qui annonce un montant et un e-mail de RIB qui en demande
 * un autre. Cette interface ne fait que mettre la liste en forme d'affichage —
 * le prix lui-même n'est **pas** figé ici : pour une offre dynamique (RH &
 * Paie, Facturation, Complet), il dépend du curseur « utilisateurs » de la
 * carte et se recalcule au rendu via `planPriceForSeats()`, la même fonction
 * que le serveur.
 */
const PLANS: PricingPlan[] = SELLABLE_PLANS.map(p => ({
  id: p.id,
  name: p.label,
  tagline: p.tagline,
  // « 0 DT/mois » se lit comme un prix qu'on a oublié de saisir — le pack
  // Freelancer n'a pas de période, il n'a pas de prix du tout.
  isFree: p.priceDT === 0 && !p.pricePerExtraUserDT,
  dynamic: !!p.pricePerExtraUserDT,
  baseSeats: p.baseSeats ?? p.seatLimit,
  seats: p.pricePerExtraUserDT
    ? `à partir de ${p.baseSeats ?? p.seatLimit} utilisateur${(p.baseSeats ?? p.seatLimit) > 1 ? 's' : ''}`
    : `${p.seatLimit} utilisateur${p.seatLimit > 1 ? 's' : ''}`,
  // Une offre sans portail client ne porte pas la ligne du tout : « + 0
  // comptes portail client » se lit comme une privation, alors que ce
  // portail n'est simplement pas ce qu'elle vend.
  portalSeats: p.portalSeatLimit > 0 ? `${p.portalSeatLimit} comptes portail client` : '',
  features: p.features,
  cta: 'Commencez gratuitement !',
  highlighted: p.highlighted,
  tone: p.highlighted ? 'navy' : p.standalone ? 'accent' : 'plain',
  launchDiscountPercent: p.launchDiscountPercent,
}));

/**
 * Les douze modules de l'application, chacun dans sa carte. La liste couvre
 * ce que le cabinet trouve réellement en se connectant — pas une sélection
 * commerciale : une page qui ne montre que le pointage laisse croire que le
 * reste n'existe pas.
 */
const HOME_FEATURES: {
  title: string; description: string; iconBg: string; iconColor: string; icon: React.ReactNode;
}[] = [
  {
    title: 'Tableau de bord Direction',
    description: "Marge sur temps, rentabilité par client, concentration du portefeuille et créances échues.",
    iconBg: '#E9ECFE', iconColor: '#3B52C4', icon: <LayoutDashboard className="w-[22px] h-[22px]" />,
  },
  {
    title: 'Pointage & chronomètre',
    description: 'Un chronomètre par collaborateur, accessible depuis toutes les pages, qui survit au rafraîchissement.',
    iconBg: '#E3F7F5', iconColor: '#00857C', icon: <Timer className="w-[22px] h-[22px]" />,
  },
  {
    title: 'Missions & types de tâches',
    description: "Un catalogue de 8 missions et 67 tâches livré d'office, adapté au métier du cabinet.",
    iconBg: '#EAFBF0', iconColor: '#15803D', icon: <ListChecks className="w-[22px] h-[22px]" />,
  },
  {
    title: 'Clients & colonnes sur mesure',
    description: 'Import du tableur existant, colonnes personnalisées, solde et encaissements par dossier.',
    iconBg: '#FFF3DE', iconColor: '#C98A1B', icon: <Building2 className="w-[22px] h-[22px]" />,
  },
  {
    title: 'Facturation conforme',
    description: 'TVA, retenue à la source, timbre fiscal, montant en toutes lettres et numérotation légale.',
    iconBg: '#FDEBEF', iconColor: '#C2416B', icon: <FileText className="w-[22px] h-[22px]" />,
  },
  {
    title: 'Trésorerie & brouillard de caisse',
    description: 'Encaissements, décaissements, solde courant et règlements clients par mode de paiement.',
    iconBg: '#E3F7F5', iconColor: '#00857C', icon: <Wallet className="w-[22px] h-[22px]" />,
  },
  {
    title: 'Suivi des échéances',
    description: 'DM, IS, IRPP, CNSS, acomptes — les exercices 2025 à 2028 livrés avec les libellés à jour.',
    iconBg: '#E9ECFE', iconColor: '#3B52C4', icon: <CalendarCheck className="w-[22px] h-[22px]" />,
  },
  {
    title: 'Outils de travail',
    description: 'Listes de pièces par type de dossier, liens utiles, avancement coché client par client.',
    iconBg: '#FFF3DE', iconColor: '#C98A1B', icon: <FolderKanban className="w-[22px] h-[22px]" />,
  },
  {
    title: 'Ressources humaines',
    description: 'Congés, autorisations d\'absence, prêts et avances — demande, approbation, solde à jour.',
    iconBg: '#EAFBF0', iconColor: '#15803D', icon: <Users className="w-[22px] h-[22px]" />,
  },
  {
    title: 'Messagerie & présence',
    description: 'Fils directs, groupes de travail, accusés de lecture et présence en direct de l\'équipe.',
    iconBg: '#FDEBEF', iconColor: '#C2416B', icon: <MessageSquare className="w-[22px] h-[22px]" />,
  },
  {
    title: 'Portail client',
    description: 'Votre client consulte son relevé et l\'avancement de ses dossiers — sans voir vos coûts.',
    iconBg: '#E3F7F5', iconColor: '#00857C', icon: <Globe className="w-[22px] h-[22px]" />,
  },
  {
    title: 'Parrainage',
    description: 'Un confrère souscrit avec votre lien : 10 % pour lui, un mois offert pour vous.',
    iconBg: '#E9ECFE', iconColor: '#3B52C4', icon: <Gift className="w-[22px] h-[22px]" />,
  },
];


/**
 * Les quatre piliers de la page « À propos » — le contenu réel remis par
 * l'utilisateur, pas un remplissage, même règle que le reste des maquettes de
 * cette page (voir Testimonials/ClientLogos plus bas dans CLAUDE.md).
 */
const ABOUT_PILLARS: {
  title: string; description: string; iconBg: string; iconColor: string; icon: React.ReactNode;
}[] = [
  {
    title: 'Une vision à 360° sans briques séparées',
    description: "Du pointage en un clic jusqu'au portail client, en passant par la facturation conforme et le suivi des échéances, tout est réuni dans une seule et même application.",
    iconBg: '#E3F7F5', iconColor: '#00857C', icon: <Globe className="w-[22px] h-[22px]" />,
  },
  {
    title: 'La marge sur temps comme boussole',
    description: "Nous ne mesurons pas seulement le chiffre d'affaires, mais la marge réelle par client et par mission en intégrant vos coûts employeurs.",
    iconBg: '#E9ECFE', iconColor: '#3B52C4', icon: <Compass className="w-[22px] h-[22px]" />,
  },
  {
    title: 'Pensé pour les usages métiers',
    description: "Des catalogues de missions et un calendrier d'échéances fiscales pré-configurés pour être opérationnels dès le premier jour.",
    iconBg: '#FFF3DE', iconColor: '#C98A1B', icon: <ListChecks className="w-[22px] h-[22px]" />,
  },
  {
    title: 'Collaboration fluide & transparence',
    description: "Une meilleure communication interne (messagerie, RH) et externe grâce à un portail client dédié qui réduit les relances inutiles.",
    iconBg: '#FDEBEF', iconColor: '#C2416B', icon: <MessageSquare className="w-[22px] h-[22px]" />,
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
  const [view, setView] = useState<'home' | 'tarifs' | 'apropos'>('home');
  /** L'en-tête se resserre dès qu'on quitte le haut de la page : au repos il
   *  respire, une fois qu'on lit il rend de la hauteur au contenu. `passive`
   *  parce qu'un écouteur de défilement qui ne prévient jamais le navigateur
   *  bloque le défilement fluide. */
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  const [modalPlan, setModalPlan] = useState<string | null>(null);
  // Le nombre de sièges choisi sur la carte cliquée — porté jusqu'à la
  // modale pour qu'elle démarre sur le même chiffre plutôt que de repartir
  // de zéro.
  const [modalSeats, setModalSeats] = useState<number>(1);
  // Un curseur par carte, indépendant des autres : changer « RH & Paie » ne
  // doit pas faire bouger le prix affiché sur « Complet ».
  const [seatsByPlan, setSeatsByPlan] = useState<Record<string, number>>({});
  const seatsFor = (p: PricingPlan) => Math.max(p.baseSeats, seatsByPlan[p.id] ?? p.baseSeats);
  const bumpSeats = (p: PricingPlan, delta: number) => {
    setSeatsByPlan(prev => {
      const current = Math.max(p.baseSeats, prev[p.id] ?? p.baseSeats);
      const next = Math.min(SEAT_STEPPER_MAX, Math.max(p.baseSeats, current + delta));
      return { ...prev, [p.id]: next };
    });
  };

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

  const goToAPropos = () => {
    setView('apropos');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goHome = () => {
    setView('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-white font-sans antialiased text-gray-900">
      {/* Header */}
      <header
        className={`sticky top-0 z-50 backdrop-blur-[10px] border-b transition-[background-color,border-color,box-shadow] duration-300 ${
          scrolled
            ? 'bg-white/[0.96] border-[#E6E9EE] shadow-[0_6px_24px_rgba(13,27,42,0.07)]'
            : 'bg-white/[0.88] border-transparent'
        }`}
      >
        <div
          className={`max-w-[1280px] mx-auto px-4 sm:px-10 flex items-center justify-between gap-3 sm:gap-6 transition-[height] duration-300 ${
            scrolled ? 'h-[62px] sm:h-[70px]' : 'h-[72px] sm:h-[84px]'
          }`}
        >
          <button onClick={goHome} className="group flex items-center gap-2 shrink-0">
            <AnimatedLogo size={28} variant="color" replayOnHover />
            {/* The wordmark is dropped on the narrowest phones to buy back the
                width the auth buttons need — the mark alone still identifies it. */}
            <span className="hidden min-[400px]:inline text-[15px] font-extrabold tracking-tight text-navy whitespace-nowrap">
              Tâches <span className="text-turquoise">&amp;</span> Cash
            </span>
          </button>

          <nav className="hidden min-[1041px]:flex items-center gap-7 min-w-0">
            <button onClick={() => goToAnchor('fonctionnalites')} className="landing-navlink text-[14px] font-medium text-[#3D4655] hover:text-navy transition-colors whitespace-nowrap">Fonctionnalités</button>
            <button onClick={() => goToAnchor('modules')} className="landing-navlink text-[14px] font-medium text-[#3D4655] hover:text-navy transition-colors whitespace-nowrap">Modules</button>
            <button onClick={() => goToAnchor('dashboard')} className="landing-navlink text-[14px] font-medium text-[#3D4655] hover:text-navy transition-colors whitespace-nowrap">Facturation</button>
            <button onClick={goToTarifs} data-active={view === 'tarifs'} className={`landing-navlink text-[14px] whitespace-nowrap ${view === 'tarifs' ? 'font-bold text-navy' : 'font-medium text-[#3D4655] hover:text-navy transition-colors'}`}>Tarifs</button>
            <button onClick={goToAPropos} data-active={view === 'apropos'} className={`landing-navlink text-[14px] whitespace-nowrap ${view === 'apropos' ? 'font-bold text-navy' : 'font-medium text-[#3D4655] hover:text-navy transition-colors'}`}>À propos</button>
            <a href={`mailto:${CONTACT_EMAIL}`} className="landing-navlink text-[14px]! font-medium text-[#3D4655]! hover:text-navy! transition-colors whitespace-nowrap">Contact</a>
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
            <button
              onClick={goToTarifs}
              className="landing-shine px-3 sm:px-[18px] py-2.5 sm:py-[11px] rounded-[10px] text-[13px] sm:text-[14px] font-bold text-white bg-navy hover:bg-turquoise hover:-translate-y-0.5 transition-all whitespace-nowrap"
            >
              Commencez gratuitement&nbsp;!
            </button>
          </div>
        </div>
      </header>

      {view === 'home' ? (
        <>
          {/* HERO — full-bleed photo blending straight into the page's own
              light background via a mask (no boxed card, no dark scrim),
              at the user's explicit request to match a reference layout:
              the photo is pinned to the right edge and fades to transparent
              on its own left edge, so the copy sits on the ordinary light
              gradient rather than needing white text over a photo. */}
          <section
            className="relative overflow-hidden"
            style={{ background: 'linear-gradient(180deg,#FBFCFD 0%, #F2F4F7 100%)' }}
          >
            {/* Décor : une seule nappe turquoise côté texte — les autres
                nappes/la trame de la version précédente tombaient sous la
                photo et ne se voyaient plus. */}
            <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
              <div
                className="absolute top-[8%] left-[-16%] w-[560px] h-[560px] animate-[landingAuroraAlt_22s_ease-in-out_infinite]"
                style={{ background: 'radial-gradient(circle, rgba(59,82,196,0.10), rgba(59,82,196,0) 68%)' }}
              />
            </div>

            {/* Photo, pinned to the right edge and masked on its own left
                edge — sm+ only; on mobile the same width would mask the
                photo out from under the text entirely, so it moves to its
                own stacked band below the copy instead (further down). */}
            <div
              aria-hidden
              className="hidden lg:block absolute inset-y-0 right-0 w-[58%] xl:w-[54%]"
              style={{
                WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, #000 32%)',
                maskImage: 'linear-gradient(90deg, transparent 0%, #000 32%)',
              }}
            >
              <img
                src="/landing/hero-photo.jpg"
                alt="Gestionnaire comptable au travail, tableau de bord Tâches &amp; Cash affiché sur son écran"
                className="w-full h-full object-cover"
                style={{ objectPosition: '86% 38%' }}
              />
            </div>

            <div className="relative max-w-[1280px] mx-auto px-6 sm:px-10 pt-[100px] pb-10 sm:pt-[120px] sm:pb-16">
              <div style={{ maxWidth: 560 }}>
                <Reveal>
                  <div className="inline-flex items-center gap-2 pl-1.5 pr-3.5 py-1.5 bg-white border border-[#E6E9EE] rounded-full shadow-[0_2px_10px_rgba(13,27,42,0.05)]">
                    <span className="px-2 py-[3px] rounded-full bg-turquoise text-white text-[10px] font-extrabold tracking-[0.04em] uppercase">Nouveau</span>
                    <span className="text-[12.5px] font-semibold text-[#3D4655]">Portail client &amp; suivi des échéances 2025–2028</span>
                  </div>
                </Reveal>
                <Reveal delay={80}>
                  <h1 className="mt-[22px] text-[34px] sm:text-[46px] leading-[1.14] font-extrabold text-navy tracking-[-0.02em]">
                    Le <span style={{ color: '#08A4A1' }}>premier logiciel</span> tunisien conçu exclusivement pour les <span style={{ color: '#08A4A1' }}>professionnels des services.</span>
                  </h1>
                </Reveal>
                <Reveal delay={150}>
                  <p className="mt-[22px] text-[19px] sm:text-[21px] leading-[1.35] font-bold text-navy">
                    Gérez mieux, facturez plus, gagnez en rentabilité
                  </p>
                  <p className="mt-2 text-[14.5px] leading-[1.5] font-light text-[#3D4655]">
                    Pour les comptables, auditeurs, fiscalistes, avocats, consultants, architectes, ingénieurs-conseils et autres professionnels des services.
                  </p>
                  <p className="mt-3 text-[17px] leading-[1.65] font-light text-[#5B6472]">
                    Centralisez vos missions, pilotez vos équipes, suivez le temps consacré à chaque client et transformez votre travail en valeur, en facturation et en rentabilité.
                  </p>
                </Reveal>
                <Reveal delay={220}>
                  <div className="mt-8 flex gap-3.5 flex-wrap">
                    <button
                      onClick={goToTarifs}
                      className="landing-shine group bg-navy text-white px-7 py-4 rounded-xl text-[15px] font-bold shadow-[0_10px_24px_rgba(13,27,42,0.22)] hover:bg-turquoise hover:shadow-[0_10px_24px_rgba(0,179,166,0.3)] hover:-translate-y-0.5 transition-all inline-flex items-center gap-2"
                    >
                      Commencez gratuitement&nbsp;!
                      <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
                    </button>
                    <button
                      onClick={() => goToAnchor('modules')}
                      className="landing-shine bg-white text-navy px-[26px] py-4 rounded-xl text-[15px] font-semibold border-[1.5px] border-[#E6E9EE] hover:border-navy hover:-translate-y-0.5 transition-all"
                    >
                      Découvrir les modules
                    </button>
                  </div>
                </Reveal>
              </div>

            </div>

            {/* Mobile: the photo drops below the copy as its own full-width
                band instead of sitting beside it — still edge to edge, still
                fading in rather than boxed, just from the top this time. */}
            <div aria-hidden className="lg:hidden relative w-full h-[240px] sm:h-[320px] mt-4">
              <div
                className="absolute inset-0"
                style={{
                  WebkitMaskImage: 'linear-gradient(180deg, transparent 0%, #000 22%)',
                  maskImage: 'linear-gradient(180deg, transparent 0%, #000 22%)',
                }}
              >
                <img
                  src="/landing/hero-photo.jpg"
                  alt=""
                  className="w-full h-full object-cover"
                  style={{ objectPosition: '62% 35%' }}
                />
              </div>
            </div>
          </section>

          <ClientLogos />

          {/* FLOW SECTION */}
          <section className="py-24 px-6 sm:px-10 bg-white">
            <div className="max-w-[980px] mx-auto text-center">
              <Reveal>
                <h2 className="text-[26px] sm:text-[32px] font-extrabold text-navy tracking-[-0.01em]">Une chaîne de valeur, entièrement connectée</h2>
                <p className="mt-4 max-w-[560px] mx-auto text-[15.5px] leading-[1.6] text-[#5B6472]">De la tâche à la trésorerie, chaque minute travaillée devient une donnée financière exploitable.</p>
              </Reveal>

              <div className="relative mt-16 flex justify-between items-start">
                {/* Le liseré est deux fois plus large que son cadre et défile :
                    le dégradé court le long de la chaîne au lieu de rester posé. */}
                <div
                  className="absolute top-[23px] sm:top-[31px] left-8 sm:left-10 right-8 sm:right-10 h-0.5 z-0 animate-[landingTrace_6s_linear_infinite]"
                  style={{ background: 'linear-gradient(90deg,#0D1B2A,#00B3A6,#22C55E,#00B3A6,#0D1B2A)', backgroundSize: '200% 100%' }}
                />
                {FLOW_STEPS.map((step, i) => (
                  <Reveal key={step.label} direction="scale" delay={i * 110} className="relative z-10 flex-1">
                    <div className="flex flex-col items-center gap-3.5">
                      {/* Plus petit sur téléphone : à cinq étapes sur 390 px,
                          des pastilles de 64 px se touchent et « Rentabilité »
                          chevauche ses voisines. */}
                      <div
                        className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-white flex items-center justify-center transition-transform hover:scale-110"
                        style={{ border: `2px solid ${step.color}`, boxShadow: `0 6px 16px ${step.shadow}` }}
                      >
                        {step.shape}
                      </div>
                      <span className="text-[11px] sm:text-[14px] font-bold leading-tight text-center px-0.5" style={{ color: step.color }}>{step.label}</span>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>
          </section>

          {/* FEATURES */}
          <section id="fonctionnalites" className="py-24 px-6 sm:px-10 bg-[#F2F4F7]">
            <div className="max-w-[1200px] mx-auto">
              <Reveal className="text-center max-w-[640px] mx-auto">
                <div className="inline-flex px-3.5 py-1.5 bg-white border border-[#E6E9EE] rounded-full text-[12px] font-bold tracking-[0.06em] uppercase text-[#00857C]">Fonctionnalités</div>
                <h2 className="mt-[18px] text-[26px] sm:text-[32px] font-extrabold text-navy tracking-[-0.01em]">Douze modules, une seule application</h2>
                <p className="mt-4 text-[15.5px] leading-[1.6] text-[#5B6472]">
                  Pas de briques à acheter séparément : chaque offre donne accès à l'intégralité des vues, du pointage au portail client.
                </p>
              </Reveal>

              <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[22px]">
                {HOME_FEATURES.map((f, i) => (
                  /* Le décalage se répète par rangée plutôt que de croître sur
                     douze cartes : au-delà de la troisième, une cascade continue
                     fait attendre le bas de la grille bien après son arrivée. */
                  <Reveal key={f.title} delay={(i % 3) * 90} className="h-full">
                    <div className="landing-shine group relative h-full bg-white rounded-[18px] border border-[#E6E9EE] p-7 hover:-translate-y-1.5 hover:border-turquoise/45 hover:shadow-[0_18px_38px_rgba(13,27,42,0.10)] transition-all duration-300">
                      {/* Le liseré turquoise se déploie depuis la gauche au
                          survol — l'accusé de réception du pointage. */}
                      <span
                        aria-hidden
                        className="absolute left-7 right-7 bottom-0 h-[3px] rounded-full bg-turquoise origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300"
                      />
                      <div
                        className="w-[46px] h-[46px] rounded-xl flex items-center justify-center transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6"
                        style={{ background: f.iconBg, color: f.iconColor }}
                      >
                        {f.icon}
                      </div>
                      <div className="text-[16px] font-bold text-navy mt-4 transition-transform duration-300 group-hover:translate-x-1">{f.title}</div>
                      <p className="text-[14px] leading-[1.55] text-[#5B6472] mt-2">{f.description}</p>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>
          </section>

          {/* TIME TRACKING SHOWCASE */}
          <section className="py-24 sm:py-[104px] px-6 sm:px-10 bg-white">
            <div className="max-w-[1200px] mx-auto flex gap-16 items-center flex-wrap-reverse">
              <Reveal direction="left" style={{ flex: '1 1 420px', minWidth: 300 }} className="bg-[#F2F4F7] rounded-[20px] p-[22px]">
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
              </Reveal>

              <Reveal direction="right" style={{ flex: '1 1 420px', minWidth: 300 }}>
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
                  onClick={goToTarifs}
                  className="landing-shine inline-block mt-8 bg-navy text-white px-[26px] py-[15px] rounded-xl text-[15px] font-bold hover:bg-turquoise hover:-translate-y-0.5 transition-all"
                >
                  Essayer le suivi du temps
                </button>
              </Reveal>
            </div>
          </section>

          {/* FACTURATION SHOWCASE */}
          <section id="dashboard" className="py-24 sm:py-[104px] px-6 sm:px-10 bg-navy text-white">
            <div className="max-w-[1200px] mx-auto flex gap-16 items-center flex-wrap">
              <Reveal direction="left" style={{ flex: '1 1 420px', minWidth: 300 }}>
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
                  onClick={goToTarifs}
                  className="landing-shine inline-block mt-8 bg-turquoise text-navy px-[26px] py-[15px] rounded-xl text-[15px] font-bold hover:bg-white hover:-translate-y-0.5 transition-all"
                >
                  Créer une facture
                </button>
              </Reveal>

              <Reveal direction="right" style={{ flex: '1 1 420px', minWidth: 300 }} className="bg-white rounded-2xl p-6 text-navy">
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
              </Reveal>
            </div>
          </section>

          {/* MODULE EXPLORER — les six modules qui n'ont pas leur propre
              section en grand. */}
          <section id="modules" className="py-24 sm:py-[104px] px-6 sm:px-10 bg-[#F2F4F7]">
            <Reveal className="text-center max-w-[640px] mx-auto mb-12">
              <div className="inline-flex px-3.5 py-1.5 bg-white border border-[#E6E9EE] rounded-full text-[12px] font-bold tracking-[0.06em] uppercase text-[#00857C]">Visite guidée</div>
              <h2 className="mt-[18px] text-[26px] sm:text-[32px] font-extrabold text-navy tracking-[-0.01em]">
                Le reste de la plateforme, écran par écran
              </h2>
              <p className="mt-4 text-[15.5px] leading-[1.6] text-[#5B6472]">
                Choisissez un module : voici exactement ce que votre équipe trouve en se connectant.
              </p>
            </Reveal>
            <Reveal delay={100}>
              <ModuleExplorer onCta={goToTarifs} />
            </Reveal>
          </section>
        </>
      ) : view === 'apropos' ? (
        <>
          {/* ABOUT HERO */}
          <section className="pt-[88px] px-6 sm:px-10 pb-10 bg-[linear-gradient(180deg,#FBFCFD_0%,#F2F4F7_100%)]">
            <div className="max-w-[760px] mx-auto text-center">
              <Reveal>
                <div className="inline-flex px-3.5 py-1.5 bg-white border border-[#E6E9EE] rounded-full text-[12px] font-bold tracking-[0.06em] uppercase text-[#00857C]">À propos</div>
              </Reveal>
              <Reveal delay={80}>
                <h1 className="mt-[18px] text-[34px] sm:text-[42px] font-extrabold text-navy tracking-[-0.02em] leading-[1.15]">
                  Connecter chaque minute travaillée à votre rentabilité réelle.
                </h1>
              </Reveal>
              <Reveal delay={150}>
                <p className="mt-[18px] text-[16.5px] text-[#5B6472] leading-[1.6]">
                  Tâches &amp; Cash a été conçu pour transformer la gestion des cabinets comptables et des entreprises de services : du temps passé au cash encaissé, en passant par le pilotage précis de vos marges.
                </p>
              </Reveal>
            </div>
          </section>

          {/* NOTRE HISTOIRE & CONSTAT */}
          <section className="py-20 px-6 sm:px-10 bg-white">
            <div className="max-w-[1200px] mx-auto flex gap-16 items-center flex-wrap-reverse">
              {/* Le constat en image : des outils épars qui flottent chacun
                  de leur côté, puis la réponse — nette, posée, à jour en
                  direct (le point qui bat, le même idiome que la carte
                  « Nouvelle tâche assignée » du hero). Aucune animation
                  nouvelle : les trois flottements, le halo qui respire et le
                  point qui pulse sont ceux déjà utilisés pour la maquette du
                  hero et le bandeau CTA. */}
              <Reveal direction="left" style={{ flex: '1 1 420px', minWidth: 300 }} className="w-full">
                <div className="relative bg-[#F2F4F7] rounded-[20px] px-6 py-10 sm:px-10 sm:py-12 overflow-hidden">
                  <div
                    aria-hidden
                    className="pointer-events-none absolute w-[260px] h-[260px] rounded-full animate-[landingBreathe_7s_ease-in-out_infinite]"
                    style={{ background: 'radial-gradient(circle, rgba(0,179,166,0.16), rgba(0,179,166,0) 70%)', top: '14%', left: '50%', transform: 'translateX(-50%)' }}
                  />
                  <div className="relative flex flex-wrap justify-center gap-3">
                    <div className="w-[132px] bg-white rounded-2xl p-3 animate-[landingFloatA_6s_ease-in-out_infinite]" style={{ boxShadow: '0 14px 26px -10px rgba(13,27,42,0.16)' }}>
                      <FileText className="w-4 h-4 text-[#8A93A0] mb-1.5" />
                      <div className="text-[10.5px] font-bold text-[#5B6472] leading-tight">Tableurs dispersés</div>
                    </div>
                    <div className="w-[132px] mt-4 bg-white rounded-2xl p-3 animate-[landingFloatC_6.5s_ease-in-out_infinite]" style={{ boxShadow: '0 14px 26px -10px rgba(13,27,42,0.16)' }}>
                      <Clock className="w-4 h-4 text-[#8A93A0] mb-1.5" />
                      <div className="text-[10.5px] font-bold text-[#5B6472] leading-tight">Heures oubliées</div>
                    </div>
                    <div className="w-[132px] bg-white rounded-2xl p-3 animate-[landingFloatB_7s_ease-in-out_infinite]" style={{ boxShadow: '0 14px 26px -10px rgba(13,27,42,0.16)' }}>
                      <AlertTriangle className="w-4 h-4 text-[#8A93A0] mb-1.5" />
                      <div className="text-[10.5px] font-bold text-[#5B6472] leading-tight">Relances manuelles</div>
                    </div>
                  </div>

                  <div className="relative flex justify-center my-4">
                    <ArrowDown className="w-6 h-6 text-turquoise" />
                  </div>

                  <div className="relative mx-auto w-[230px] bg-white rounded-2xl p-4 border-2 border-turquoise" style={{ boxShadow: '0 20px 40px -14px rgba(0,179,166,0.3)' }}>
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-[10px] bg-[#E3F7F5] flex items-center justify-center text-[#00857C] shrink-0">
                        <LayoutDashboard className="w-[18px] h-[18px]" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="w-[6px] h-[6px] rounded-full bg-[#22C55E] shrink-0 animate-[landingPulseDot_2s_ease-in-out_infinite]" />
                          <span className="text-[13px] font-extrabold text-navy leading-tight">Tâches &amp; Cash</span>
                        </div>
                        <div className="text-[9.5px] text-[#8A93A0] mt-0.5">Une vision unique, à jour en direct</div>
                      </div>
                    </div>
                  </div>
                </div>
              </Reveal>

              <div style={{ flex: '1 1 400px', minWidth: 300 }}>
                <Reveal direction="right">
                  <div className="inline-flex px-3.5 py-1.5 bg-[#F2F4F7] rounded-full text-[12px] font-bold tracking-[0.06em] uppercase text-[#00857C]">Notre histoire</div>
                  <h2 className="mt-[18px] text-[24px] sm:text-[28px] font-extrabold text-navy tracking-[-0.01em]">Pourquoi nous avons créé Tâches &amp; Cash ?</h2>
                </Reveal>
                <Reveal direction="right" delay={90}>
                  <div className="mt-6 space-y-4 text-[15.5px] leading-[1.75] text-[#3D4655]">
                    <p>Dans beaucoup de cabinets et d'entreprises de services, un constat s'impose : savoir ce qu'on facture est facile, mais savoir ce que chaque dossier coûte réellement est souvent un casse-tête.</p>
                    <p>Entre les feuilles de calcul dispersées, les heures oubliées, la gestion administrative lourde (échéances, congés, relances) et la pression des délais, les équipes perdent un temps précieux et la direction manque de visibilité sur ses marges.</p>
                    <p>C'est pour répondre à ce besoin du terrain que Tâches &amp; Cash est né : une plateforme SaaS unifiée qui relie la gestion opérationnelle quotidienne à la performance financière.</p>
                  </div>
                </Reveal>
              </div>
            </div>
          </section>

          {/* NOTRE MISSION */}
          <section className="pb-20 px-6 sm:px-10 bg-white">
            <Reveal direction="scale" className="max-w-[900px] mx-auto">
              <div className="relative bg-navy rounded-[28px] px-8 sm:px-14 py-14 text-center overflow-hidden">
                <div aria-hidden className="absolute w-[300px] h-[300px] rounded-full bg-[radial-gradient(circle,rgba(0,179,166,0.22),rgba(0,179,166,0)_70%)] -top-24 -left-16 pointer-events-none" />
                <div className="relative">
                  <div className="inline-flex px-3.5 py-1.5 bg-white/10 rounded-full text-[12px] font-bold tracking-[0.06em] uppercase text-turquoise">Notre mission</div>
                  <p className="mt-6 text-[22px] sm:text-[26px] font-extrabold text-white leading-[1.4] max-w-[640px] mx-auto">
                    « Redonner aux cabinets et entreprises le contrôle total sur leur temps, leur trésorerie et leur croissance. »
                  </p>
                  <p className="mt-6 text-[15px] text-white/65 max-w-[560px] mx-auto leading-[1.65]">
                    Nous croyons que chaque minute travaillée doit devenir une donnée exploitable. Notre objectif est de simplifier l'organisation interne pour permettre aux managers, collaborateurs et experts de se concentrer sur leur cœur de métier et la satisfaction de leurs clients.
                  </p>
                </div>
              </div>
            </Reveal>
          </section>

          {/* NOS PILIERS */}
          <section className="py-20 px-6 sm:px-10 bg-[#F2F4F7]">
            <div className="max-w-[1000px] mx-auto">
              <Reveal className="text-center max-w-[640px] mx-auto">
                <div className="inline-flex px-3.5 py-1.5 bg-white border border-[#E6E9EE] rounded-full text-[12px] font-bold tracking-[0.06em] uppercase text-[#00857C]">Nos piliers</div>
                <h2 className="mt-[18px] text-[26px] sm:text-[32px] font-extrabold text-navy tracking-[-0.01em]">Ce qui nous rend uniques</h2>
              </Reveal>

              <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 gap-[22px]">
                {ABOUT_PILLARS.map((f, i) => (
                  <Reveal key={f.title} delay={(i % 2) * 90} className="h-full">
                    <div className="landing-shine group relative h-full bg-white rounded-[18px] border border-[#E6E9EE] p-7 hover:-translate-y-1.5 hover:border-turquoise/45 hover:shadow-[0_18px_38px_rgba(13,27,42,0.10)] transition-all duration-300">
                      <span
                        aria-hidden
                        className="absolute left-7 right-7 bottom-0 h-[3px] rounded-full bg-turquoise origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300"
                      />
                      <div
                        className="w-[46px] h-[46px] rounded-xl flex items-center justify-center transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6"
                        style={{ background: f.iconBg, color: f.iconColor }}
                      >
                        {f.icon}
                      </div>
                      <div className="text-[16px] font-bold text-navy mt-4 transition-transform duration-300 group-hover:translate-x-1">{f.title}</div>
                      <p className="text-[14px] leading-[1.55] text-[#5B6472] mt-2">{f.description}</p>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>
          </section>

          {/* CHIFFRES / IMPACT */}
          <section className="py-20 px-6 sm:px-10 bg-white">
            <div className="max-w-[1000px] mx-auto">
              <Reveal className="text-center max-w-[640px] mx-auto">
                <h2 className="text-[26px] sm:text-[32px] font-extrabold text-navy tracking-[-0.01em]">L'impact, en quelques mots</h2>
              </Reveal>
              <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-8">
                <Reveal direction="scale" className="text-center px-4">
                  <div className="text-[42px] sm:text-[48px] font-extrabold text-navy tracking-[-0.02em]"><CountUp to={12} /></div>
                  <p className="mt-2 text-[14.5px] text-[#5B6472] leading-[1.55]">modules intégrés pour remplacer la multiplication des outils et tableurs.</p>
                </Reveal>
                <Reveal direction="scale" delay={90} className="text-center px-4">
                  <div className="text-[42px] sm:text-[48px] font-extrabold text-turquoise tracking-[-0.02em]"><CountUp to={100} suffix=" %" /></div>
                  <p className="mt-2 text-[14.5px] text-[#5B6472] leading-[1.55]">de conformité dans la facturation (TVA, retenue à la source, timbre fiscal).</p>
                </Reveal>
                <Reveal direction="scale" delay={180} className="text-center px-4">
                  <div className="text-[42px] sm:text-[48px] font-extrabold text-[#22C55E]">↑</div>
                  <p className="mt-2 text-[14.5px] text-[#5B6472] leading-[1.55]">Une vision claire du temps facturable vs. non facturable pour maximiser vos revenus.</p>
                </Reveal>
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
                Freelancer est gratuit pour un indépendant seul, avec 10 documents de facturation inclus chaque
                mois. Complet ouvre tout le cabinet, à plusieurs comptes, et son prix s'ajuste instantanément au
                nombre d'utilisateurs.
              </p>
            </div>
          </section>

          {/* PRICING CARDS — deux offres seulement (Freelancer, Complet) : RH
              & Paie et Facturation ont été retirées du catalogue et fondues
              dans Complet (voir plans.ts). Le grid n'a donc plus besoin de
              respirer sur quatre colonnes — resserré et recentré, sinon deux
              cartes perdues dans une rangée de 1240px de large lisent comme
              un catalogue à moitié vide plutôt que comme un choix simple. */}
          <section className="pt-6 px-6 sm:px-10 pb-[100px] bg-[#F2F4F7]">
            <div className="max-w-[820px] mx-auto grid grid-cols-1 sm:grid-cols-2 gap-6 items-stretch">
              {PLANS.map(plan => {
                const tone = TONES[plan.tone];
                const meta = planMeta(plan.id);
                const seats = seatsFor(plan);
                // Le prix affiché suit exactement `planPriceForSeats()` — la
                // même fonction que le serveur utilise pour le mail de RIB et
                // la confirmation de paiement, pour qu'un montant annoncé ici
                // ne puisse jamais diverger de ce qui sera réellement demandé.
                const priceDT = plan.isFree ? 0 : planPriceForSeats(meta, seats);
                return (
                <div
                  key={plan.id}
                  className={`relative rounded-[20px] px-[30px] py-9 text-left flex flex-col ${tone.card}`}
                >
                  {plan.highlighted && (
                    <span className="absolute -top-[13px] left-1/2 -translate-x-1/2 bg-turquoise text-navy text-[11px] font-extrabold px-[14px] py-[5px] rounded-full tracking-[0.03em] whitespace-nowrap">
                      Le plus populaire
                    </span>
                  )}
                  <h3 className={`text-[15px] font-bold ${tone.title}`}>{plan.name}</h3>
                  <p className={`text-[13.5px] mt-1.5 ${tone.muted}`}>{plan.tagline}</p>

                  {/* Remise de lancement : le tarif catalogue (25 DT/utilisateur/mois)
                      barré à côté du tarif réellement facturé (15 DT), dérivé de
                      `planListPriceForSeats()` — jamais un second prix saisi à la
                      main qui pourrait diverger du montant que le mail de RIB et
                      la confirmation de paiement annoncent réellement. */}
                  {plan.launchDiscountPercent != null && (
                    <span className={`inline-flex items-center gap-1 mt-3 px-2.5 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-[0.03em] ${tone.bullet}`}>
                      Offre de lancement · −{plan.launchDiscountPercent}%
                    </span>
                  )}

                  <div className="mt-6 flex items-baseline gap-1.5">
                    {!plan.isFree && plan.launchDiscountPercent != null && (
                      <span className={`text-[20px] font-semibold line-through ${tone.muted}`}>
                        {formatDT(planListPriceForSeats(meta, seats) ?? 0)}
                      </span>
                    )}
                    <span className={`text-[40px] font-extrabold ${tone.title}`}>{plan.isFree ? 'Gratuit' : formatDT(priceDT)}</span>
                    {!plan.isFree && <span className={`text-[14px] ${tone.muted}`}>/mois</span>}
                  </div>
                  <p className={`text-[13px] mt-1 ${tone.muted}`}>{plan.seats}</p>
                  {/* Les comptes du portail client se comptent dans un panier
                      séparé des sièges de l'équipe — la carte le dit, faute de
                      quoi « 5 utilisateurs + 50 portail » se lit comme 55. */}
                  {plan.portalSeats && (
                    <p className={`text-[13px] ${tone.portal}`}>+ {plan.portalSeats}</p>
                  )}

                  {/* Freelance seule porte un quota de documents — le dire ici
                      évite la surprise du message de verrouillage à la 11ᵉ
                      facture, et le lien mailto reprend l'adresse déjà utilisée
                      partout ailleurs sur cette page plutôt qu'en inventer une. */}
                  {plan.id === 'FREELANCER' && (
                    <p className={`text-[12.5px] mt-3 leading-snug ${tone.muted}`}>
                      10 factures/mois incluses. Besoin de plus ?{' '}
                      <a href={`mailto:${CONTACT_EMAIL}`} className="text-turquoise font-semibold hover:underline">
                        {FREELANCER_UPGRADE_PRICE_DT} DT/mois pour illimité
                      </a>
                    </p>
                  )}

                  {/* Paiement annuel : 2 mois offerts — une note, pas un
                      calculateur : aucun paiement en ligne n'existe dans cette
                      application, le tarif annuel se négocie comme le reste de
                      la facturation, hors app, une fois contacté. En vert à la
                      demande explicite de l'utilisateur, sur les deux offres. */}
                  <p className="text-[12px] mt-2 font-semibold text-emerald-600">
                    2 mois offerts en paiement annuel
                  </p>

                  {/* Le calculateur : +10 DT par utilisateur au-delà du
                      premier, recalculé instantanément — aucun aller-retour
                      réseau, juste `planPriceForSeats()` rappelée à chaque
                      clic. N'apparaît que sur une offre dynamique ; Freelancer
                      n'a ni curseur ni second siège à afficher. */}
                  {plan.dynamic && (
                    <div className={`mt-4 flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 ${tone.rule}`}>
                      <span className={`text-[12.5px] font-semibold ${tone.title}`}>Utilisateurs</span>
                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => bumpSeats(plan, -1)}
                          disabled={seats <= plan.baseSeats}
                          aria-label="Retirer un utilisateur"
                          className={`w-7 h-7 rounded-lg flex items-center justify-center text-[15px] font-bold transition-colors disabled:opacity-30 ${tone.bullet}`}
                        >
                          −
                        </button>
                        <span className={`text-[14px] font-bold w-6 text-center ${tone.title}`}>{seats}</span>
                        <button
                          type="button"
                          onClick={() => bumpSeats(plan, 1)}
                          disabled={seats >= SEAT_STEPPER_MAX}
                          aria-label="Ajouter un utilisateur"
                          className={`w-7 h-7 rounded-lg flex items-center justify-center text-[15px] font-bold transition-colors disabled:opacity-30 ${tone.bullet}`}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  )}

                  <div className={`h-px my-6 ${tone.rule}`} />

                  <div className="flex flex-col gap-3 flex-1">
                    {plan.features.map(f => (
                      <div key={f} className="flex items-start gap-2.5">
                        <span className={`w-4 h-4 mt-0.5 rounded-full flex items-center justify-center text-[9px] font-extrabold shrink-0 ${tone.bullet}`}>✓</span>
                        <span className={`text-[13.5px] leading-snug ${tone.feature}`}>{f}</span>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => { setModalPlan(plan.name); setModalSeats(seats); }}
                    className={`mt-7 w-full py-[14px] px-6 rounded-xl text-[14.5px] font-bold transition-colors ${tone.cta}`}
                  >
                    {plan.cta}
                  </button>
                </div>
                );
              })}
            </div>

            <p className="mt-9 text-center text-[13.5px] text-[#8A93A0]">
              Besoin de plus de {SEAT_STEPPER_MAX} utilisateurs ?{' '}
              <button onClick={() => { setModalPlan('Sur mesure'); setModalSeats(1); }} className="text-turquoise font-semibold hover:underline">
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
            {/* Le motion graphic de la marque : l'anneau se dessine, le trait
                de validation se trace, les barres montent, puis l'anneau et
                son point tournent. */}
            <AnimatedLogo size={72} variant="white" className="justify-center mb-6 w-full" />
            <h2 className="text-[26px] sm:text-[30px] font-extrabold text-white tracking-[-0.01em] max-w-[600px] mx-auto leading-[1.25]">
              {view === 'apropos'
                ? 'Prêt à piloter votre cabinet par la rentabilité ?'
                : 'Prêt à voir où va vraiment votre temps et votre argent ?'}
            </h2>
            <p className="mt-4 text-[15.5px] text-white/65 max-w-[480px] mx-auto">
              {view === 'tarifs'
                ? "Choisissez votre offre ci-dessus pour créer votre compte — l'essai est gratuit, aucune carte bancaire requise."
                : view === 'apropos'
                  ? "Rejoignez les équipes qui maîtrisent leur temps et développent leur chiffre d'affaires avec Tâches & Cash."
                  : 'Rejoignez les équipes qui pilotent leur rentabilité avec Tâches & Cash.'}
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3.5">
              <button
                onClick={goToTarifs}
                className="landing-shine inline-flex items-center gap-2 px-[30px] py-4 rounded-xl text-[15px] font-bold text-navy bg-turquoise hover:bg-white hover:-translate-y-0.5 transition-all group"
              >
                {view === 'tarifs' ? 'Voir les offres' : view === 'apropos' ? 'Commencer gratuitement' : 'Démarrer maintenant'}
                <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
              </button>
              {view === 'apropos' && (
                <button
                  onClick={() => goToAnchor('modules')}
                  className="landing-shine px-[26px] py-4 rounded-xl text-[15px] font-semibold text-white border-[1.5px] border-white/25 hover:border-white/60 hover:-translate-y-0.5 transition-all"
                >
                  Découvrir les modules
                </button>
              )}
            </div>
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
              Suivi du temps • Facturation • Croissance
            </p>
          </div>
          <div className="flex gap-16 flex-wrap">
            <div>
              <p className="text-[12px] font-bold text-white uppercase tracking-[0.05em] mb-3.5">Produit</p>
              <div className="flex flex-col gap-2.5">
                <button onClick={() => goToAnchor('fonctionnalites')} className="text-left text-[13.5px] text-white/60 hover:text-white transition-colors">Fonctionnalités</button>
                <button onClick={() => goToAnchor('modules')} className="text-left text-[13.5px] text-white/60 hover:text-white transition-colors">Modules</button>
                <button onClick={goToTarifs} className="text-left text-[13.5px] text-white/60 hover:text-white transition-colors">Tarifs</button>
              </div>
            </div>
            <div>
              <p className="text-[12px] font-bold text-white uppercase tracking-[0.05em] mb-3.5">Entreprise</p>
              <div className="flex flex-col gap-2.5">
                <button onClick={goToAPropos} className="text-left text-[13.5px] text-white/60 hover:text-white transition-colors">À propos</button>
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

      {modalPlan && <RequestAccessModal plan={modalPlan} initialSeats={modalSeats} onClose={() => setModalPlan(null)} />}
    </div>
  );
};
