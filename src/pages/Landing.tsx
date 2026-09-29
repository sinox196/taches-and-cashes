import React, { useState, useEffect } from 'react';
import { Mail, LayoutDashboard, ListChecks, FileText, MessageSquare, Globe, ArrowRight, Compass, Clock, AlertTriangle, ArrowDown } from 'lucide-react';
import { Logo } from '../components/Logo';
import { RequestAccessModal } from '../components/landing/RequestAccessModal';
import { Reveal, CountUp } from '../components/landing/Reveal';
import { HomeView } from '../components/landing/HomeView';
import { AnimatedLogo } from '../components/landing/AnimatedLogo';
import { LandingNav, type PublicView } from '../components/landing/LandingNav';
import { ContactView } from '../components/landing/ContactView';
import { FeaturesView } from '../components/landing/FeaturesView';
import { SupportView } from '../components/landing/SupportView';
import { SELLABLE_PLANS, planMeta, planPriceForSeats, planListPriceForSeats, formatDT, FREELANCER_UPGRADE_PRICE_DT } from '../constants/plans';

const CONTACT_EMAIL = 'contact@taches-and-cash.com';
/** Same number the support brief gave for the page's phone card; also what
 *  the WhatsApp link below is built from, so the two can never disagree. */
const CONTACT_PHONE = '+216 46 229 339';
const CONTACT_WHATSAPP_URL = `https://wa.me/${CONTACT_PHONE.replace(/[^\d]/g, '')}`;


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
  const readView = (): PublicView => {
    const value = window.location.hash.slice(1);
    return ['fonctionnalites', 'tarifs', 'apropos', 'support', 'contact'].includes(value) ? value as PublicView : 'home';
  };
  const [view, setCurrentView] = useState<PublicView>(readView);
  const setView = (next: PublicView) => {
    if (next !== view) window.history.pushState(null, '', `${window.location.pathname}${window.location.search}${next === 'home' ? '' : `#${next}`}`);
    setCurrentView(next);
  };
  useEffect(() => {
    const restore = () => { setCurrentView(readView()); window.scrollTo({ top: 0, behavior: 'instant' }); };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  useEffect(() => {
    const titles: Record<PublicView, string> = { home: 'Le temps de votre équipe a de la valeur', fonctionnalites: 'Fonctionnalités', tarifs: 'Tarifs', apropos: 'À propos', support: 'Centre d’assistance', contact: 'Contact' };
    document.title = `${titles[view]} | Tâches & Cash`;
  }, [view]);
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

  // Un compteur de visites, pas des analytics — aucune donnée de session ni
  // de cookie, juste un total incrémenté à chaque chargement de la page,
  // affiché ensuite dans la console plateforme. Fire-and-forget : un échec
  // réseau ne doit rien changer à l'affichage de la page.
  useEffect(() => {
    fetch('/api/landing/visit', { method: 'POST' }).catch(() => {});
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

  /** Scrolls to a section on whichever page is already showing — unlike
   *  `goToAnchor`, which always routes back to `home` first. Support's own
   *  in-page anchors (guide/faq/contact) never need that redirect. */
  const scrollToId = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  const goToTarifs = () => {
    setView('tarifs');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goToAPropos = () => {
    setView('apropos');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goToSupport = () => {
    setView('support');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goHome = () => {
    setView('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="public-site min-h-screen bg-white font-sans antialiased text-gray-900">
      <a href="#public-content" className="public-skip-link" onClick={event => { event.preventDefault(); document.getElementById('public-content')?.focus(); }}>Aller au contenu</a>
      <LandingNav view={view} scrolled={scrolled} onLogin={onLogin} onNavigate={next => {
        setView(next);
        window.scrollTo({ top: 0, behavior: 'instant' });
        requestAnimationFrame(() => document.getElementById('public-content')?.focus({ preventScroll: true }));
      }} />
      <main id="public-content" tabIndex={-1}>
      {view === 'home' ? (
        <HomeView onStart={goToTarifs} onFeatures={() => { setView('fonctionnalites'); window.scrollTo({ top: 0, behavior: 'instant' }); }} onContact={() => { setView('contact'); window.scrollTo({ top: 0, behavior: 'instant' }); }} />
      ) : view === 'fonctionnalites' ? (
        <FeaturesView onStart={goToTarifs} />
      ) : view === 'contact' ? (
        <ContactView email={CONTACT_EMAIL} phone={CONTACT_PHONE} whatsappUrl={CONTACT_WHATSAPP_URL} onSupport={goToSupport} />
      ) : view === 'apropos' ? (
        <>
          {/* ABOUT HERO */}
          <section className="marketing-page-intro pt-[88px] px-6 sm:px-10 pb-10 bg-[linear-gradient(180deg,#FBFCFD_0%,#F2F4F7_100%)]">
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
              <Reveal direction="left" style={{ flex: '1 1 420px', minWidth: 0 }} className="w-full">
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

              <div style={{ flex: '1 1 400px', minWidth: 0 }}>
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
      ) : view === 'support' ? (
        <SupportView
          contactEmail={CONTACT_EMAIL}
          contactPhone={CONTACT_PHONE}
          whatsappUrl={CONTACT_WHATSAPP_URL}
          guideHref="/guide/Guide-Taches-et-Cash.docx"
        />
      ) : (
        <>
          {/* PRICING HERO */}
          <section className="marketing-page-intro pt-[88px] px-6 sm:px-10 pb-10 bg-[linear-gradient(180deg,#FBFCFD_0%,#F2F4F7_100%)]">
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
                  className={`pricing-card relative rounded-[20px] px-[30px] py-9 text-left flex flex-col ${tone.card}`}
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
                    <div className={`mt-4 flex items-center gap-3 rounded-xl px-3 py-2.5 ${tone.rule}`}>
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
                      <span className={`text-[12.5px] font-semibold ${tone.title}`}>Utilisateurs</span>
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

      {/* Other public pages share this CTA; HomeView has its own. */}
      {view !== 'home' && <section className="py-24 px-6 sm:px-10 bg-white">
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
                : view === 'support'
                  ? 'Votre réussite est notre priorité'
                  : 'Prêt à voir où va vraiment votre temps et votre argent ?'}
            </h2>
            <p className="mt-4 text-[15.5px] text-white/65 max-w-[480px] mx-auto">
              {view === 'tarifs'
                ? "Choisissez votre offre ci-dessus pour créer votre compte — l'essai est gratuit, aucune carte bancaire requise."
                : view === 'apropos'
                  ? "Rejoignez les équipes qui maîtrisent leur temps et développent leur chiffre d'affaires avec Tâches & Cash."
                  : view === 'support'
                    ? 'Nous mettons tout en œuvre pour vous offrir une expérience simple, fluide et efficace.'
                    : 'Rejoignez les équipes qui pilotent leur rentabilité avec Tâches & Cash.'}
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3.5">
              <button
                onClick={view === 'support' ? () => scrollToId('support-contact') : goToTarifs}
                className="landing-shine inline-flex items-center gap-2 px-[30px] py-4 rounded-xl text-[15px] font-bold text-navy bg-turquoise hover:bg-white hover:-translate-y-0.5 transition-all group"
              >
                {view === 'tarifs' ? 'Voir les offres' : view === 'apropos' ? 'Commencer gratuitement' : view === 'support' ? 'Contacter le support' : 'Démarrer maintenant'}
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
      </section>}

      </main>
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
                <button onClick={goToSupport} className="text-left text-[13.5px] text-white/60 hover:text-white transition-colors">Support</button>
              </div>
            </div>
            <div>
              <p className="text-[12px] font-bold text-white uppercase tracking-[0.05em] mb-3.5">Entreprise</p>
              <div className="flex flex-col gap-2.5">
                <button onClick={goToAPropos} className="text-left text-[13.5px] text-white/60 hover:text-white transition-colors">À propos</button>
                <button onClick={() => { setView('contact'); window.scrollTo({ top: 0, behavior: 'instant' }); }} className="flex items-center gap-1.5 text-[13.5px] text-white/60 hover:text-white transition-colors">
                  <Mail className="w-3.5 h-3.5" /> Contact
                </button>
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
